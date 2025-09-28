package com.margelo.nitro.nitrofetch

import android.util.Log
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import org.chromium.net.CronetEngine
import org.chromium.net.CronetException
import org.chromium.net.UrlRequest
import org.chromium.net.UrlResponseInfo
import java.nio.ByteBuffer
import java.util.concurrent.Executor

fun ByteBuffer.toByteArray(): ByteArray {
  // duplicate to avoid modifying the original buffer's position
  val dup = this.duplicate()
  dup.clear() // sets position=0, limit=capacity
  val arr = ByteArray(dup.remaining())
  dup.get(arr)
  return arr
}

@DoNotStrip
class NitroFetchClient(private val engine: CronetEngine, private val executor: Executor) : HybridNitroFetchClientSpec() {

  private fun findPrefetchKey(req: NitroRequest): String? {
    val h = req.headers ?: return null
    for (pair in h) {
      val k = pair.key
      val v = pair.value
      if (k.equals("prefetchKey", ignoreCase = true)) return v
    }
    return null
  }

  companion object {
    @JvmStatic
    fun fetch(
      req: NitroRequest,
      onSuccess: (NitroResponse) -> Unit,
      onFail: (Throwable) -> Unit
    ) {
      try {
        val engine = NitroFetch.getEngine()
        val executor = NitroFetch.ioExecutor
        startCronet(engine, executor, req, onSuccess, onFail)
      } catch (t: Throwable) {
        onFail(t)
      }
    }

    private fun startCronet(
      engine: CronetEngine,
      executor: Executor,
      req: NitroRequest,
      onSuccess: (NitroResponse) -> Unit,
      onFail: (Throwable) -> Unit
    ) {
      val url = req.url
      val callback = object : UrlRequest.Callback() {
        private val buffer = ByteBuffer.allocateDirect(16 * 1024)
        private val out = java.io.ByteArrayOutputStream()

        override fun onRedirectReceived(request: UrlRequest, info: UrlResponseInfo, newLocationUrl: String) {
          request.followRedirect()
        }

        override fun onResponseStarted(request: UrlRequest, info: UrlResponseInfo) {
          buffer.clear()
          request.read(buffer)
        }

        override fun onReadCompleted(request: UrlRequest, info: UrlResponseInfo, byteBuffer: ByteBuffer) {
          byteBuffer.flip()
          val bytes = ByteArray(byteBuffer.remaining())
          byteBuffer.get(bytes)
          out.write(bytes)
          byteBuffer.clear()
          request.read(byteBuffer)
        }

        override fun onSucceeded(request: UrlRequest, info: UrlResponseInfo) {
          try {
            val headersArr: Array<NitroHeader> =
              info.allHeadersAsList.map { NitroHeader(it.key, it.value) }.toTypedArray()
            val status = info.httpStatusCode
            val bytes = out.toByteArray()
            val contentType = info.allHeaders["Content-Type"] ?: info.allHeaders["content-type"]
            val charset = run {
              val ct = contentType ?: ""
              val m = Regex("charset=([A-Za-z0-9_\\-:.]+)", RegexOption.IGNORE_CASE).find(ct.toString())
              try {
                if (m != null) java.nio.charset.Charset.forName(m.groupValues[1]) else Charsets.UTF_8
              } catch (_: Throwable) {
                Charsets.UTF_8
              }
            }
            val bodyStr = try { String(bytes, charset) } catch (_: Throwable) { String(bytes, Charsets.UTF_8) }
            val res = NitroResponse(
              url = info.url,
              status = status.toDouble(),
              statusText = info.httpStatusText ?: "",
              ok = status in 200..299,
              redirected = info.url != url,
              headers = headersArr,
              bodyString = bodyStr,
              bodyBytes = null
            )
            onSuccess(res)
          } catch (t: Throwable) {
            onFail(t)
          }
        }

        override fun onFailed(request: UrlRequest, info: UrlResponseInfo?, error: CronetException) {
          onFail(RuntimeException("Cronet failed: ${error.message}", error))
        }

        override fun onCanceled(request: UrlRequest, info: UrlResponseInfo?) {
          onFail(RuntimeException("Cronet canceled"))
        }
      }

      val builder = engine.newUrlRequestBuilder(url, callback, executor)
      val method = req.method?.name ?: "GET"
      builder.setHttpMethod(method)
      req.headers?.forEach { (k, v) -> builder.addHeader(k, v) }
      val bodyBytes = req.bodyBytes
      val bodyStr = req.bodyString
      if ((bodyBytes != null) || !bodyStr.isNullOrEmpty()) {
        val body: ByteArray = when {
          bodyBytes != null -> ByteArray(1);//bodyBytes.getBuffer(true).toByteArray()
          !bodyStr.isNullOrEmpty() -> bodyStr!!.toByteArray(Charsets.UTF_8)
          else -> ByteArray(0)
        }
        val provider = object : org.chromium.net.UploadDataProvider() {
          private var pos = 0
          override fun getLength(): Long = body.size.toLong()
          override fun read(uploadDataSink: org.chromium.net.UploadDataSink, byteBuffer: ByteBuffer) {
            val remaining = body.size - pos
            val toWrite = minOf(byteBuffer.remaining(), remaining)
            byteBuffer.put(body, pos, toWrite)
            pos += toWrite
            uploadDataSink.onReadSucceeded(false)
          }
          override fun rewind(uploadDataSink: org.chromium.net.UploadDataSink) {
            pos = 0
            uploadDataSink.onRewindSucceeded()
          }
        }
        builder.setUploadDataProvider(provider, executor)
      }
      val request = builder.build()
      request.start()
    }
  }

  override fun request(req: NitroRequest): Promise<NitroResponse> {
    val promise = Promise<NitroResponse>()
    // Try to serve from prefetch cache/pending first
    val key = findPrefetchKey(req)
    if (key != null) {
      // If a prefetch is currently pending, wait for it
      FetchCache.getPending(key)?.let { fut ->
        fun withPrefetchedHeader(res: NitroResponse): NitroResponse {
          val newHeaders = (res.headers?.toMutableList() ?: mutableListOf())
          newHeaders.add(NitroHeader("nitroPrefetched", "true"))
          return NitroResponse(
            url = res.url,
            status = res.status,
            statusText = res.statusText,
            ok = res.ok,
            redirected = res.redirected,
            headers = newHeaders.toTypedArray(),
            bodyString = res.bodyString,
            bodyBytes = res.bodyBytes
          )
        }
        fut.whenComplete { res, err ->
          if (err != null) {
            promise.reject(err)
          } else if (res != null) {
            promise.resolve(withPrefetchedHeader(res))
          } else {
            promise.reject(IllegalStateException("Prefetch pending returned null result"))
          }
        }
        return promise
      }
      // If a fresh prefetched result exists (<=5s old), return it immediately
      FetchCache.getResultIfFresh(key, 5_000L)?.let { cached ->
        val newHeaders = (cached.headers?.toMutableList() ?: mutableListOf())
        newHeaders.add(NitroHeader("nitroPrefetched", "true"))
        val wrapped = NitroResponse(
          url = cached.url,
          status = cached.status,
          statusText = cached.statusText,
          ok = cached.ok,
          redirected = cached.redirected,
          headers = newHeaders.toTypedArray(),
          bodyString = cached.bodyString,
          bodyBytes = cached.bodyBytes
        )
        promise.resolve(wrapped)
        return promise
      }
    }
    fetch(
      req,
      onSuccess = { promise.resolve(it) },
      onFail = { promise.reject(it) }
    )
    return promise
  }

  override fun prefetch(req: NitroRequest): Promise<Unit> {
    val promise = Promise<Unit>()
    val key = findPrefetchKey(req)
    if (key.isNullOrEmpty()) {
      promise.reject(IllegalArgumentException("prefetch: missing 'prefetchKey' header"))
      return promise
    }
    // If already have a fresh result, resolve immediately
    FetchCache.getResultIfFresh(key, 5_000L)?.let {
      promise.resolve(Unit)
      return promise
    }
    // If already pending, resolve when it's done
    FetchCache.getPending(key)?.let { fut ->
      fut.whenComplete { _, err -> if (err != null) promise.reject(err) else promise.resolve(Unit) }
      return promise
    }
    // Start new prefetch
    val future = java.util.concurrent.CompletableFuture<NitroResponse>()
    FetchCache.setPending(key, future)
    fetch(
      req,
      onSuccess = { res ->
        try {
          FetchCache.complete(key, res)
          promise.resolve(Unit)
        } catch (t: Throwable) {
          FetchCache.completeExceptionally(key, t)
          promise.reject(t)
        }
      },
      onFail = { err ->
        FetchCache.completeExceptionally(key, err)
        promise.reject(err)
      }
    )
    return promise
  }

  override fun requestSync(req: NitroRequest): NitroResponse {
    // Try to serve from prefetch cache first
    val key = findPrefetchKey(req)
    if (key != null) {
      // If a fresh prefetched result exists (<=5s old), return it immediately
      FetchCache.getResultIfFresh(key, 5_000L)?.let { cached ->
        val newHeaders = (cached.headers?.toMutableList() ?: mutableListOf())
        newHeaders.add(NitroHeader("nitroPrefetched", "true"))
        return NitroResponse(
          url = cached.url,
          status = cached.status,
          statusText = cached.statusText,
          ok = cached.ok,
          redirected = cached.redirected,
          headers = newHeaders.toTypedArray(),
          bodyString = cached.bodyString,
          bodyBytes = cached.bodyBytes
        )
      }
    }

    // For synchronous requests, we need to block until the request completes
    val latch = java.util.concurrent.CountDownLatch(1)
    var result: NitroResponse? = null
    var error: Throwable? = null

    fetch(
      req,
      onSuccess = { res ->
        result = res
        latch.countDown()
      },
      onFail = { err ->
        error = err
        latch.countDown()
      }
    )

    try {
      latch.await()
    } catch (e: InterruptedException) {
      throw RuntimeException("Request was interrupted", e)
    }

    if (error != null) {
      throw RuntimeException("Request failed", error)
    }

    return result ?: throw RuntimeException("Request completed but no result was returned")
  }


}
