package com.margelo.nitro.nitrofetch

import com.facebook.react.packagerconnection.PackagerConnectionSettings
import com.margelo.nitro.NitroModules
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.Buffer
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.lang.reflect.Field
import java.lang.reflect.Method
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/** RN < 0.83 fallback: Expo-shaped CDP events via the Expo CLI `/inspector/network` websocket (SDK 52+) or `ExpoRequestCdpInterceptor` (SDK 51 + dev-client); buffered while the sink resolves. */
internal class CdpFallbackReporterImpl : DevToolsReporter.Impl {

  private enum class Done { NONE, FINISHED, FAILED }

  private class Record(
    val url: String,
    val method: String,
    val headers: Map<String, String>,
    val body: String,
    val startWall: Double
  ) {
    var responded = false
    var status = 0
    var responseHeaders: Map<String, String> = emptyMap()
    var mimeType = ""
    var done = Done.NONE
    var finishedEncoded = 0L
    var failCancelled = false
    val textBody = StringBuilder()
    var fullBody: String? = null
    var fullBodyBase64 = false
    var bodyOverflow = false
  }

  private enum class Sink { RESOLVING, WS, EXPO, DEAD }

  private val lock = Any()
  private val records = LinkedHashMap<String, Record>()
  private var sink = Sink.RESOLVING
  private var ws: WebSocket? = null
  private var expo: ExpoFeeder? = null
  private var diedAt = 0L

  private val scheduler: ScheduledExecutorService =
    Executors.newSingleThreadScheduledExecutor { r ->
      Thread(r, "nitrofetch-devtools-cdp").apply { isDaemon = true }
    }
  private val client = OkHttpClient()

  init {
    scheduler.execute { connectWebSocket(0) }
  }

  override fun isDebuggingEnabled(): Boolean {
    synchronized(lock) {
      if (sink == Sink.DEAD && System.currentTimeMillis() - diedAt > 30_000) {
        sink = Sink.RESOLVING
        scheduler.execute { connectWebSocket(0) }
      }
      return sink != Sink.DEAD
    }
  }

  override fun reportRequestStart(
    requestId: String, url: String, method: String,
    headers: Map<String, String>, body: String, encodedDataLength: Long
  ) {
    val rec = Record(url, method, headers, body, nowSec())
    synchronized(lock) {
      if (sink == Sink.DEAD) return
      while (records.size >= MAX_RECORDS) {
        val eldest = records.keys.firstOrNull() ?: break
        records.remove(eldest)
      }
      records[requestId] = rec
      if (sink == Sink.WS) {
        sendLocked(requestWillBeSentJson(requestId, rec))
        sendLocked(extraInfoJson(requestId, rec))
      }
    }
  }

  override fun reportResponseStart(
    requestId: String, url: String, statusCode: Int,
    headers: Map<String, String>, expectedDataLength: Long
  ) {
    synchronized(lock) {
      val rec = records[requestId] ?: return
      rec.responded = true
      rec.status = statusCode
      rec.responseHeaders = headers
      rec.mimeType = mimeFromHeaders(headers)
      if (sink == Sink.WS) sendLocked(responseReceivedJson(requestId, rec, expectedDataLength))
    }
  }

  override fun reportDataReceived(requestId: String, length: Int) {}

  override fun reportResponseEnd(requestId: String, encodedDataLength: Long) {
    synchronized(lock) {
      val rec = records[requestId] ?: return
      rec.finishedEncoded = encodedDataLength
      when (sink) {
        Sink.WS -> {
          records.remove(requestId)
          bodyJsonOrNull(requestId, rec)?.let { sendLocked(it) }
          sendLocked(loadingFinishedJson(requestId, encodedDataLength))
        }
        Sink.EXPO -> {
          records.remove(requestId)
          val feeder = expo ?: return
          scheduler.execute { feeder.emit(requestId, rec) }
        }
        Sink.RESOLVING -> rec.done = Done.FINISHED
        Sink.DEAD -> records.remove(requestId)
      }
    }
  }

  override fun reportRequestFailed(requestId: String, cancelled: Boolean) {
    synchronized(lock) {
      val rec = records[requestId] ?: return
      rec.failCancelled = cancelled
      when (sink) {
        Sink.WS -> {
          records.remove(requestId)
          sendLocked(loadingFailedJson(requestId, cancelled))
        }
        Sink.EXPO, Sink.DEAD -> records.remove(requestId)
        Sink.RESOLVING -> rec.done = Done.FAILED
      }
    }
  }

  override fun storeResponseBody(requestId: String, body: String, base64Encoded: Boolean) {
    synchronized(lock) {
      val rec = records[requestId] ?: return
      if (body.length > MAX_BODY_SIZE) {
        rec.bodyOverflow = true
      } else {
        rec.fullBody = body
        rec.fullBodyBase64 = base64Encoded
      }
    }
  }

  override fun storeResponseBodyIncremental(requestId: String, data: String) {
    synchronized(lock) {
      val rec = records[requestId] ?: return
      if (rec.bodyOverflow) return
      if (rec.textBody.length + data.length > MAX_BODY_SIZE) {
        rec.bodyOverflow = true
        rec.textBody.setLength(0)
      } else {
        rec.textBody.append(data)
      }
    }
  }

  private fun connectWebSocket(attempt: Int) {
    val host = try {
      NitroModules.applicationContext?.let { PackagerConnectionSettings(it).debugServerHost }
    } catch (_: Throwable) {
      null
    }
    if (host.isNullOrBlank()) {
      if (attempt < 5) {
        scheduler.schedule({ connectWebSocket(attempt + 1) }, 1, TimeUnit.SECONDS)
      } else {
        resolveExpoOrDie(0)
      }
      return
    }
    val req = okhttp3.Request.Builder().url("ws://$host/inspector/network").build()
    client.newWebSocket(req, object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: okhttp3.Response) {
        synchronized(lock) {
          ws = webSocket
          sink = Sink.WS
          flushToWsLocked()
        }
      }

      override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
        handleWsGone(wasEndpointMissing = response != null)
      }

      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        handleWsGone(wasEndpointMissing = false)
      }
    })
  }

  private fun handleWsGone(wasEndpointMissing: Boolean) {
    val wasOpen = synchronized(lock) {
      val open = sink == Sink.WS
      if (open) {
        sink = Sink.RESOLVING
        ws = null
      }
      open
    }
    if (wasOpen) {
      scheduler.schedule({ connectWebSocket(0) }, 3, TimeUnit.SECONDS)
    } else if (wasEndpointMissing) {
      resolveExpoOrDie(0)
    } else {
      // Metro may still be starting; retry the endpoint a few times before giving up.
      scheduler.schedule({ retryOrExpo() }, 2, TimeUnit.SECONDS)
    }
  }

  private var wsRetries = 0
  private fun retryOrExpo() {
    if (wsRetries < 3) {
      wsRetries++
      connectWebSocket(5)
    } else {
      resolveExpoOrDie(0)
    }
  }

  private fun resolveExpoOrDie(attempt: Int) {
    val feeder = expo ?: ExpoFeeder.tryCreate()?.also { expo = it }
    if (feeder == null) {
      die()
      return
    }
    if (feeder.delegateWired()) {
      val finished: List<Pair<String, Record>>
      synchronized(lock) {
        sink = Sink.EXPO
        finished = records.filterValues { it.done == Done.FINISHED }.toList()
        records.entries.removeAll { it.value.done != Done.NONE }
      }
      for ((id, rec) in finished) scheduler.execute { feeder.emit(id, rec) }
    } else if (attempt < 20) {
      scheduler.schedule({ resolveExpoOrDie(attempt + 1) }, 500, TimeUnit.MILLISECONDS)
    } else {
      die()
    }
  }

  private fun die() {
    synchronized(lock) {
      sink = Sink.DEAD
      records.clear()
      diedAt = System.currentTimeMillis()
    }
  }

  private fun flushToWsLocked() {
    val it = records.entries.iterator()
    while (it.hasNext()) {
      val (id, rec) = it.next()
      sendLocked(requestWillBeSentJson(id, rec))
      sendLocked(extraInfoJson(id, rec))
      if (rec.responded) sendLocked(responseReceivedJson(id, rec, -1))
      when (rec.done) {
        Done.FINISHED -> {
          bodyJsonOrNull(id, rec)?.let { j -> sendLocked(j) }
          sendLocked(loadingFinishedJson(id, rec.finishedEncoded))
          it.remove()
        }
        Done.FAILED -> {
          sendLocked(loadingFailedJson(id, rec.failCancelled))
          it.remove()
        }
        Done.NONE -> {}
      }
    }
  }

  private fun sendLocked(json: JSONObject) {
    ws?.send(json.toString())
  }

  // Event shapes mirror expo-modules-core's CdpNetworkTypes
  private fun nowSec(): Double = System.currentTimeMillis() / 1000.0

  private fun event(method: String, params: JSONObject): JSONObject =
    JSONObject().put("method", method).put("params", params)

  private fun requestWillBeSentJson(id: String, rec: Record): JSONObject {
    val request = JSONObject()
      .put("url", rec.url)
      .put("method", rec.method)
      .put("headers", JSONObject(rec.headers))
    if (rec.body.isNotEmpty()) request.put("postData", rec.body)
    return event(
      "Network.requestWillBeSent",
      JSONObject()
        .put("requestId", id)
        .put("loaderId", "")
        .put("documentURL", "mobile")
        .put("request", request)
        .put("timestamp", rec.startWall)
        .put("wallTime", rec.startWall)
        .put("initiator", JSONObject().put("type", "script"))
        .put("redirectHasExtraInfo", false)
        .put("referrerPolicy", "no-referrer")
        .put("type", "Fetch")
    )
  }

  private fun extraInfoJson(id: String, rec: Record): JSONObject = event(
    "Network.requestWillBeSentExtraInfo",
    JSONObject()
      .put("requestId", id)
      .put("associatedCookies", JSONObject())
      .put("headers", JSONObject(rec.headers))
      .put("connectTiming", JSONObject().put("requestTime", rec.startWall))
  )

  private fun responseReceivedJson(id: String, rec: Record, expected: Long): JSONObject = event(
    "Network.responseReceived",
    JSONObject()
      .put("requestId", id)
      .put("loaderId", "")
      .put("timestamp", nowSec())
      .put("type", resourceType(rec.mimeType))
      .put(
        "response",
        JSONObject()
          .put("url", rec.url)
          .put("status", rec.status)
          .put("statusText", "")
          .put("headers", JSONObject(rec.responseHeaders))
          .put("mimeType", rec.mimeType)
          .put("encodedDataLength", if (expected > 0) expected else 0)
      )
      .put("hasExtraInfo", false)
  )

  private fun bodyJsonOrNull(id: String, rec: Record): JSONObject? {
    if (rec.bodyOverflow) return null
    val body = rec.fullBody ?: rec.textBody.takeIf { it.isNotEmpty() }?.toString() ?: return null
    return event(
      "Expo(Network.receivedResponseBody)",
      JSONObject()
        .put("requestId", id)
        .put("body", body)
        .put("base64Encoded", rec.fullBody != null && rec.fullBodyBase64)
    )
  }

  private fun loadingFinishedJson(id: String, encoded: Long): JSONObject = event(
    "Network.loadingFinished",
    JSONObject()
      .put("requestId", id)
      .put("timestamp", nowSec())
      .put("encodedDataLength", encoded)
  )

  private fun loadingFailedJson(id: String, cancelled: Boolean): JSONObject = event(
    "Network.loadingFailed",
    JSONObject()
      .put("requestId", id)
      .put("timestamp", nowSec())
      .put("type", "Fetch")
      .put("errorText", if (cancelled) "net::ERR_ABORTED" else "net::ERR_FAILED")
      .put("canceled", cancelled)
  )

  private fun mimeFromHeaders(headers: Map<String, String>): String {
    val ct = headers.entries.firstOrNull { it.key.equals("content-type", ignoreCase = true) }?.value ?: return ""
    return ct.substringBefore(';').trim()
  }

  private fun resourceType(mime: String): String = when {
    mime.startsWith("image/") -> "Image"
    mime.startsWith("audio") || mime.startsWith("video") -> "Media"
    mime.startsWith("font") -> "Font"
    else -> "Fetch"
  }

  /** SDK 51 path: replay completed requests into `ExpoRequestCdpInterceptor` as synthetic okhttp objects once dev-client has wired its delegate (`Delegate?` on 51, `WeakReference` newer). */
  private class ExpoFeeder private constructor(
    private val target: Any,
    private val willSend: Method,
    private val didReceive: Method,
    private val delegateField: Field
  ) {
    fun delegateWired(): Boolean = try {
      val v = delegateField.get(target)
      val inner = if (v is WeakReference<*>) v.get() else v
      inner != null
    } catch (_: Throwable) {
      false
    }

    fun emit(requestId: String, rec: Record) {
      try {
        val method = rec.method.uppercase()
        val builder = okhttp3.Request.Builder().url(rec.url)
        for ((k, v) in rec.headers) runCatching { builder.addHeader(k, v) }
        val contentType = rec.headers.entries
          .firstOrNull { it.key.equals("content-type", ignoreCase = true) }
          ?.value?.toMediaTypeOrNull()
        val requestBody = when {
          method == "GET" || method == "HEAD" -> null
          rec.body.isNotEmpty() -> rec.body.toRequestBody(contentType)
          method == "POST" || method == "PUT" || method == "PATCH" -> ByteArray(0).toRequestBody(null)
          else -> null
        }
        val okReq = builder.method(method, requestBody).build()
        willSend.invoke(target, requestId, okReq, null)

        val mime = rec.mimeType.toMediaTypeOrNull()
        val response = okhttp3.Response.Builder()
          .request(okReq)
          .protocol(Protocol.HTTP_1_1)
          .code(rec.status)
          .message("")
          .apply { for ((k, v) in rec.responseHeaders) runCatching { addHeader(k, v) } }
          .body(sizedEmptyBody(mime, rec.finishedEncoded))
          .build()
        val text = if (rec.bodyOverflow || rec.fullBodyBase64) null
        else rec.fullBody ?: rec.textBody.takeIf { it.isNotEmpty() }?.toString()
        didReceive.invoke(target, requestId, okReq, response, text?.toResponseBody(mime))
      } catch (_: Throwable) {
      }
    }

    private fun sizedEmptyBody(mime: MediaType?, len: Long): ResponseBody = object : ResponseBody() {
      override fun contentType(): MediaType? = mime
      override fun contentLength(): Long = if (len > 0) len else 0
      override fun source(): okio.BufferedSource = Buffer()
    }

    companion object {
      fun tryCreate(): ExpoFeeder? = try {
        val cls = Class.forName("expo.modules.kotlin.devtools.ExpoRequestCdpInterceptor")
        val instance = cls.getDeclaredField("INSTANCE").get(null)!!
        ExpoFeeder(
          instance,
          cls.methods.first { it.name == "willSendRequest" },
          cls.methods.first { it.name == "didReceiveResponse" },
          cls.getDeclaredField("delegate").apply { isAccessible = true }
        )
      } catch (_: Throwable) {
        null
      }
    }
  }

  private companion object {
    const val MAX_RECORDS = 128
    const val MAX_BODY_SIZE = 1_048_576
  }
}
