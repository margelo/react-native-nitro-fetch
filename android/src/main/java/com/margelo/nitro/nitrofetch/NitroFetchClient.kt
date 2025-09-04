package com.margelo.nitro.nitrofetch

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
  override fun request(req: NitroRequest): Promise<NitroResponse> {
    val promise = Promise<NitroResponse>()
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
          // Build headers as NitroHeader[]
          val headersArr: Array<NitroHeader> =
            info.allHeadersAsList
              .map { NitroHeader(it.key, it.value) }
              .toTypedArray()

          val status = info.httpStatusCode

          // Accumulated body -> String (prefer charset from Content-Type, else UTF-8)
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
            bodyBytes = null,
          )
          promise.resolve(res)
        } catch (t: Throwable) {
          promise.reject(t)
        }
      }

      override fun onFailed(request: UrlRequest, info: UrlResponseInfo?, error: CronetException) {
        promise.reject(RuntimeException("Cronet failed: ${error.message}", error))
      }

      override fun onCanceled(request: UrlRequest, info: UrlResponseInfo?) {
        promise.reject(RuntimeException("Cronet canceled"))
      }
    }

    val builder = engine.newUrlRequestBuilder(url, callback, executor)
    // Method
    val method = req.method?.name ?: "GET"
    builder.setHttpMethod(method)
    // Headers
    req.headers?.forEach { (k, v) -> builder.addHeader(k, v) }
    // Body (string or bytes)
    val bodyBytes = req.bodyBytes
    val bodyStr = req.bodyString
    if ((bodyBytes != null) || !bodyStr.isNullOrEmpty()) {
      val body: ByteArray = when {
        bodyBytes != null -> bodyBytes.getBuffer(true).toByteArray()
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
    return promise
  }
}
