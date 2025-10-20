import Foundation
import NitroModules

class HybridNitroCronet: HybridNitroCronetSpec {
  func newUrlRequestBuilder(
    url: String,
    callback: UrlRequestCallback
  ) throws -> any HybridUrlRequestBuilderSpec {
    return HybridUrlRequestBuilder()
  }

  func prefetch(
    url: String,
    httpMethod: String,
    headers: Dictionary<String, String>,
    body: Variant_ArrayBuffer_String?,
    maxAge: Double
  ) throws -> Promise<Void> {
    // Dummy implementation - just resolve immediately
    return Promise.async {
      return ()
    }
  }

  func consumeNativePrefetch(prefetchKey: String) throws -> Promise<CachedFetchResponse?> {
    // Dummy implementation - return nil
    return Promise.async {
      return nil
    }
  }
}
