package com.margelo.nitro.nitrofetch

import android.net.Uri
import android.os.Trace
import android.util.Log
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import org.chromium.net.CronetEngine
import org.chromium.net.CronetException
import org.chromium.net.UrlRequest
import org.chromium.net.UrlResponseInfo
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
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
  
  private val activeRequests = ConcurrentHashMap<String, UrlRequest>()

  override fun cancelRequest(requestId: String) {
    // https://developer.android.com/develop/connectivity/cronet/reference/org/chromium/net/UrlRequest#cancel() 
    activeRequests.remove(requestId)?.cancel()
  }

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
    ): UrlRequest? {
      return try {
        val engine = NitroFetch.getEngine()
        val executor = NitroFetch.ioExecutor
        startCronet(engine, executor, req, onSuccess, onFail)
      } catch (t: Throwable) {
        onFail(t)
        null
      }
    }

    private fun startCronet(
      engine: CronetEngine,
      executor: Executor,
      req: NitroRequest,
      onSuccess: (NitroResponse) -> Unit,
      onFail: (Throwable) -> Unit
    ): UrlRequest {
      val url = req.url
      val shouldFollowRedirects = req.followRedirects ?: true
      val traceLabel = if (BuildConfig.NITRO_FETCH_TRACING) {
        "NitroFetch ${req.method?.name ?: "GET"} ${Uri.parse(url).path ?: url}"
      } else ""
      val traceCookie = if (BuildConfig.NITRO_FETCH_TRACING) url.hashCode() else 0
      if (BuildConfig.NITRO_FETCH_TRACING) {
        Trace.beginAsyncSection(traceLabel, traceCookie)
      }
      val callback = object : UrlRequest.Callback() {
        private val buffer = ByteBuffer.allocateDirect(16 * 1024)
        private val out = java.io.ByteArrayOutputStream()
        private var redirectStopped = false

        override fun onRedirectReceived(request: UrlRequest, info: UrlResponseInfo, newLocationUrl: String) {
          if (shouldFollowRedirects) {
            request.followRedirect()
          } else {
            // Return the redirect response as-is without following
            redirectStopped = true
            request.cancel()
            try {
              val headersArr = info.allHeadersAsList.map { NitroHeader(it.key, it.value) }.toTypedArray()
              val status = info.httpStatusCode
              val res = NitroResponse(
                url = info.url,
                status = status.toDouble(),
                statusText = info.httpStatusText ?: "",
                ok = false,
                redirected = false,
                headers = headersArr,
                bodyString = "",
                bodyBytes = null
              )
              onSuccess(res)
            } catch (t: Throwable) {
              onFail(t)
            }
          }
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
          if (BuildConfig.NITRO_FETCH_TRACING) {
            Trace.endAsyncSection(traceLabel, traceCookie)
          }
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
          if (BuildConfig.NITRO_FETCH_TRACING) {
            Trace.endAsyncSection(traceLabel, traceCookie)
          }
          onFail(RuntimeException("Cronet failed: ${error.message}", error))
        }

        override fun onCanceled(request: UrlRequest, info: UrlResponseInfo?) {
          if (BuildConfig.NITRO_FETCH_TRACING) {
            Trace.endAsyncSection(traceLabel, traceCookie)
          }
          if (!redirectStopped) {
            onFail(RuntimeException("Cronet canceled"))
          }
        }
      }

      val builder = engine.newUrlRequestBuilder(url, callback, executor)
      val method = req.method?.name ?: "GET"
      builder.setHttpMethod(method)
      req.headers?.forEach { (k, v) -> builder.addHeader(k, v) }

      val formParts = req.bodyFormData
      if (formParts != null && formParts.isNotEmpty()) {
        val (multipartBody, contentType) = buildMultipartBody(formParts)
        builder.addHeader("Content-Type", contentType)
        val provider = createUploadProvider(multipartBody)
        builder.setUploadDataProvider(provider, executor)
      } else {
        val bodyBytes = req.bodyBytes
        val bodyStr = req.bodyString
        if ((bodyBytes != null) || !bodyStr.isNullOrEmpty()) {
          val body: ByteArray = when {
            bodyBytes != null -> ByteArray(1)
            !bodyStr.isNullOrEmpty() -> bodyStr!!.toByteArray(Charsets.UTF_8)
            else -> ByteArray(0)
          }
          val provider = createUploadProvider(body)
          builder.setUploadDataProvider(provider, executor)
        }
      }

      val request = builder.build()
      request.start()
      return request
    }

    private fun createUploadProvider(body: ByteArray): org.chromium.net.UploadDataProvider {
      return object : org.chromium.net.UploadDataProvider() {
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
    }

    private fun buildMultipartBody(parts: Array<NitroFormDataPart>): Pair<ByteArray, String> {
      val boundary = "NitroFetch-${UUID.randomUUID()}"
      val out = ByteArrayOutputStream()
      val crlf = "\r\n".toByteArray()

      for (part in parts) {
        out.write("--$boundary\r\n".toByteArray())

        val fileUri = part.fileUri
        if (fileUri != null) {
          val fileName = part.fileName ?: "file"
          val mimeType = part.mimeType ?: "application/octet-stream"
          out.write("Content-Disposition: form-data; name=\"${part.name}\"; filename=\"$fileName\"\r\n".toByteArray())
          out.write("Content-Type: $mimeType\r\n\r\n".toByteArray())

          val fileData = readFileBytes(fileUri)
          out.write(fileData)
        } else {
          val value = part.value ?: ""
          out.write("Content-Disposition: form-data; name=\"${part.name}\"\r\n\r\n".toByteArray())
          out.write(value.toByteArray(Charsets.UTF_8))
        }

        out.write(crlf)
      }

      out.write("--$boundary--\r\n".toByteArray())
      return Pair(out.toByteArray(), "multipart/form-data; boundary=$boundary")
    }

    private fun readFileBytes(uri: String): ByteArray {
      if (uri.startsWith("http://") || uri.startsWith("https://")) {
        val url = java.net.URL(uri)
        return url.openStream().use { it.readBytes() }
      }
      if (uri.startsWith("content://")) {
        val context = NitroModules.applicationContext
          ?: throw IllegalStateException("Cannot read content:// URI - no Android Context")
        val inputStream = context.contentResolver.openInputStream(Uri.parse(uri))
          ?: throw IllegalArgumentException("Cannot open content URI: $uri")
        return inputStream.use { it.readBytes() }
      }
      val path = if (uri.startsWith("file://")) uri.removePrefix("file://") else uri
      return File(path).readBytes()
    }
  }

  // Helper function to add prefetch header to response (reused by both sync/async)
  private fun withPrefetchedHeader(res: NitroResponse): NitroResponse {
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

  override fun requestSync(req: NitroRequest): NitroResponse {
    val key = findPrefetchKey(req)
    if (key != null) {
      FetchCache.getPending(key)?.let { fut ->
        return try {
          withPrefetchedHeader(fut.get()) // blocks until complete
        } catch (e: Exception) {
          throw e.cause ?: e
        }
      }
      FetchCache.getResultIfFresh(key, 5_000L)?.let { cached ->
        return withPrefetchedHeader(cached)
      }
    }
    val latch = java.util.concurrent.CountDownLatch(1)
    var result: NitroResponse? = null
    var error: Throwable? = null
    
    fetch(
      req,
      onSuccess = { 
        result = it
        latch.countDown()
      },
      onFail = { 
        error = it
        latch.countDown()
      }
    )
    latch.await()
    error?.let { throw it }
    return result!!
  }

  override fun request(req: NitroRequest): Promise<NitroResponse> {
    val promise = Promise<NitroResponse>()
    // Try to serve from prefetch cache/pending first
    val key = findPrefetchKey(req)
    if (key != null) {
      // If a prefetch is currently pending, wait for it
      FetchCache.getPending(key)?.let { fut ->
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
        promise.resolve(withPrefetchedHeader(cached))
        return promise
      }
    }
    val requestId = req.requestId
    val urlRequest = fetch(
      req,
      onSuccess = { res ->
        if (requestId != null) activeRequests.remove(requestId)
        promise.resolve(res)
      },
      onFail = { err ->
        if (requestId != null) activeRequests.remove(requestId)
        promise.reject(err)
      }
    )
    // Store after start() — if cancelRequest races and misses, the JS
    // catch block checks signal.aborted and throws AbortError anyway.
    if (requestId != null && urlRequest != null) {
      activeRequests[requestId] = urlRequest
    }
    return promise
  }

  override fun prefetch(req: NitroRequest): Promise<Unit> {
    val promise = Promise<Unit>()
    val key = findPrefetchKey(req)
    if (key.isNullOrEmpty()) {
      promise.reject(IllegalArgumentException("prefetch: missing 'prefetchKey' header"))
      return promise
    }
    // If already have a fresh result, resolve immediately (NON-DESTRUCTIVE CHECK)
    if (FetchCache.hasFreshResult(key, 5_000L)) {
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


}
