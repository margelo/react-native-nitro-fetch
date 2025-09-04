package nitrofetch.example

import android.os.Bundle
import android.util.Log
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import org.chromium.net.CronetEngine
import org.chromium.net.UrlRequest
import org.chromium.net.UrlResponseInfo
import java.nio.ByteBuffer
import java.util.concurrent.Executors

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "NitroFetchExample"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

//    val executor = Executors.newSingleThreadExecutor()
//    val engine = CronetEngine.Builder(this)
//      // The storage path must be set first when using a disk cache.
//      .setStoragePath(this.filesDir.absolutePath)
//
//      // Enable on-disk cache, this enables automatic QUIC usage for subsequent requests
//      // to the same domain across application restarts. If you also want to cache HTTP
//      // responses, use HTTP_CACHE_DISK instead. Typically you will want to enable caching
//      // in full, we turn it off for this demo to better demonstrate Cronet's behavior
//      // using net protocols.
//      .enableHttpCache(CronetEngine.Builder.HTTP_CACHE_DISK_NO_HTTP, 100 * 1024)
//
//      // HTTP2 and QUIC support is enabled by default. When both are enabled (and no hints
//      // are provided), Cronet tries to use both protocols and it's nondeterministic which
//      // one will be used for the first few requests. As soon as Cronet is aware that
//      // a server supports QUIC, it will always attempt to use it first. Try disabling
//      // and enabling HTTP2 support and see how the negotiated protocol changes! Also try
//      // forcing a new connection by enabling and disabling flight mode after the first
//      // request to ensure QUIC usage.
//      .enableHttp2(true)
//      .enableQuic(true)
//
//      // Brotli support is NOT enabled by default.
//      .enableBrotli(true)
//
//      // One can provide a custom user agent if desired.
//      .setUserAgent("CronetSampleApp")
//
//      // As noted above, QUIC hints speed up initial requests to a domain. Multiple hints
//      // can be added. We don't enable them in this demo to demonstrate how QUIC
//      // is being used if no hints are provided.
//
//      // .addQuicHint("storage.googleapis.com", 443, 443)
//      // .addQuicHint("www.googleapis.com", 443, 443)
//      .build();
//
//    val url = "https://www.google.com"
//
//    val callback = object : UrlRequest.Callback() {
//      private val buffer = ByteBuffer.allocateDirect(16 * 1024)
//
//      override fun onRedirectReceived(request: UrlRequest, info: UrlResponseInfo, newLocationUrl: String) {
//        Log.i("CronetTest", "Redirect to $newLocationUrl")
//        request.followRedirect()
//      }
//
//      override fun onResponseStarted(request: UrlRequest, info: UrlResponseInfo) {
//        Log.i("CronetTest", "Response started: ${info.httpStatusCode}")
//        buffer.clear()
//        request.read(buffer)
//      }
//
//      override fun onReadCompleted(request: UrlRequest, info: UrlResponseInfo, byteBuffer: ByteBuffer) {
//        byteBuffer.flip()
//        val bytes = ByteArray(byteBuffer.remaining())
//        byteBuffer.get(bytes)
//        Log.i("CronetTest", "Read chunk of ${bytes.size} bytes")
//        byteBuffer.clear()
//        request.read(byteBuffer)
//      }
//
//      override fun onSucceeded(request: UrlRequest, info: UrlResponseInfo) {
//        Log.i("CronetTest", "Succeeded with status ${info.httpStatusCode}")
//      }
//
//      override fun onFailed(request: UrlRequest, info: UrlResponseInfo?, error: org.chromium.net.CronetException) {
//        Log.e("CronetTest", "Failed: ${error.message}", error)
//      }
//
//      override fun onCanceled(request: UrlRequest, info: UrlResponseInfo?) {
//        Log.w("CronetTest", "Canceled")
//      }
//    }
//
//    val request = engine.newUrlRequestBuilder(url, callback, executor)
//      .setHttpMethod("GET")
//      .build()
//
//    request.start()
  }
}
