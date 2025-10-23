import Foundation
import NitroModules

class HybridNitroCronet: HybridNitroCronetSpec {
  // Shared URLSession for all requests
  private static let session: URLSession = {
    let config = URLSessionConfiguration.default
    config.requestCachePolicy = .useProtocolCachePolicy
    config.urlCache = URLCache(
      memoryCapacity: 32 * 1024 * 1024,
      diskCapacity: 100 * 1024 * 1024,
      diskPath: "nitrofetch_urlcache"
    )
    return URLSession(configuration: config)
  }()

  // Shared executor queue
  private static let executorQueue = DispatchQueue(
    label: "com.nitrofetch.executor",
    qos: .userInitiated,
    attributes: .concurrent
  )

  func newUrlRequestBuilder(url: String) throws -> any HybridUrlRequestBuilderSpec {
    return HybridUrlRequestBuilder(
      url: url,
      session: HybridNitroCronet.session,
      executor: HybridNitroCronet.executorQueue
    )
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
