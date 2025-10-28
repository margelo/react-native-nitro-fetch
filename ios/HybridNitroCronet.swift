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
    let promise = Promise<Void>()
    let maxAgeMs = Int64(maxAge)

    // Extract prefetchKey from headers
    let prefetchKey = headers.first { key, _ in
      key.caseInsensitiveCompare("prefetchKey") == .orderedSame
    }?.value

    guard let prefetchKey = prefetchKey, !prefetchKey.isEmpty else {
      promise.reject(withError: NSError(
        domain: "HybridNitroCronet",
        code: -1,
        userInfo: [NSLocalizedDescriptionKey: "prefetch requires a 'prefetchKey' header"]
      ))
      return promise
    }

    // Check if already have a fresh result
    if FetchCache.getResultIfFresh(prefetchKey, maxAgeMs: maxAgeMs) != nil {
      promise.resolve(withResult: ())
      return promise
    }

    // Check if already pending
    if FetchCache.getPending(prefetchKey) {
      FetchCache.addPending(prefetchKey) { result in
        switch result {
        case .success:
          promise.resolve(withResult: ())
        case .failure(let error):
          promise.reject(withError: error)
        }
      }
      return promise
    }

    // Convert body to Data if provided
    var bodyData: Data?
    if let body = body {
      switch body {
      case .first(let arrayBuffer):
        bodyData = arrayBuffer.toData(copyIfNeeded: true)
      case .second(let string):
        bodyData = string.data(using: .utf8)
      }
    }

    // Start the prefetch
    SimpleFetch.prefetch(
      url: url,
      method: httpMethod,
      headers: headers,
      body: bodyData,
      prefetchKey: prefetchKey,
      maxAgeMs: maxAgeMs
    ) { result in
      switch result {
      case .success:
        promise.resolve(withResult: ())
      case .failure(let error):
        promise.reject(withError: error)
      }
    }

    return promise
  }

  func consumeNativePrefetch(prefetchKey: String) throws -> Promise<CachedFetchResponse?> {
    let promise = Promise<CachedFetchResponse?>()

    // Try to get a fresh cached result (uses the entry's stored maxAge)
    if let cached = FetchCache.getResultIfFresh(prefetchKey) {
      var headersDict = cached.headers
      headersDict["nitroPrefetched"] = "true"

      // Convert Data to ArrayBuffer
      do {
        let arrayBuffer = try ArrayBuffer.copy(data: cached.body)
        let result = CachedFetchResponse(
          url: cached.url,
          status: Double(cached.statusCode),
          statusText: cached.statusText,
          headers: headersDict,
          body: arrayBuffer
        )
        promise.resolve(withResult: result)
      } catch {
        promise.reject(withError: error)
      }
      return promise
    }

    // Check if a prefetch is pending
    if FetchCache.getPending(prefetchKey) {
      FetchCache.addPending(prefetchKey) { result in
        switch result {
        case .success(let cached):
          var headersDict = cached.headers
          headersDict["nitroPrefetched"] = "true"

          // Convert Data to ArrayBuffer
          do {
            let arrayBuffer = try ArrayBuffer.copy(data: cached.body)
            let response = CachedFetchResponse(
              url: cached.url,
              status: Double(cached.statusCode),
              statusText: cached.statusText,
              headers: headersDict,
              body: arrayBuffer
            )
            promise.resolve(withResult: response)
          } catch {
            promise.reject(withError: error)
          }
        case .failure(let error):
          promise.reject(withError: error)
        }
      }
      return promise
    }

    // Not found in cache and not pending - return nil for graceful fallback
    // This allows the JS layer to automatically fall back to a normal fetch
    promise.resolve(withResult: nil)
    return promise
  }
}
