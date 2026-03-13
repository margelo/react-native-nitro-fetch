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
    body: Variant_String_ArrayBuffer?,
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
      case .first(let string):
        bodyData = string.data(using: .utf8)
      case .second(let arrayBuffer):
        bodyData = arrayBuffer.toData(copyIfNeeded: true)
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
  func fetchSync(
    url: String,
    httpMethod: string,
    headers: Dictionary<String, String>,
    body: String?
  ) throws -> SyncFetchResponse {
    // 1. Check Prefetch Cache
    let prefetchKey = headers.first { key, _ in
      key.caseInsensitiveCompare("prefetchKey") == .orderedSame
    }?.value

    if let prefetchKey = prefetchKey, !prefetchKey.isEmpty {
      if let cached = FetchCache.getResultIfFresh(prefetchKey) {
        var headersDict = cached.headers
        headersDict["nitroPrefetched"] = "true"
        let bodyStr = String(data: cached.body, encoding: .utf8) ?? ""
        return SyncFetchResponse(
          url: cached.url,
          status: Double(cached.statusCode),
          statusText: cached.statusText,
          headers: headersDict,
          body: bodyStr
        )
      }

      if FetchCache.getPending(prefetchKey) {
        let sem = DispatchSemaphore(value: 0)
        var pendingResult: Result<CachedFetchResponse, Error>?
        FetchCache.addPending(prefetchKey) { res in
          switch res {
          case .success(let cached):
            var headersDict = cached.headers
            headersDict["nitroPrefetched"] = "true"
            let bodyStr = String(data: cached.body, encoding: .utf8) ?? ""
            let response = SyncFetchResponse(
              url: cached.url,
              status: Double(cached.statusCode),
              statusText: cached.statusText,
              headers: headersDict,
              body: bodyStr
            )
            pendingResult = .success(response)
          case .failure(let error):
            pendingResult = .failure(error)
          }
          sem.signal()
        }
        sem.wait()
        switch pendingResult! {
        case .success(let response): return response
        case .failure(let error): throw error
        }
      }
    }

    // 2. Perform Synchronous Fetch
    let semaphore = DispatchSemaphore(value: 0)
    var result: Result<CachedFetchResponse, Error>?

    guard let urlObj = URL(string: url) else {
      throw NSError(domain: "HybridNitroCronet", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid URL"])
    }

    var request = URLRequest(url: urlObj)
    request.httpMethod = httpMethod
    for (k, v) in headers {
      request.setValue(v, forHTTPHeaderField: k)
    }

    if let b = body {
      request.httpBody = b.data(using: .utf8)
    }

    let task = HybridNitroCronet.session.dataTask(with: request) { data, response, error in
      if let error = error {
        result = .failure(error)
      } else if let data = data, let httpResponse = response as? HTTPURLResponse {
        do {
          var responseHeaders: [String: String] = [:]
          for (k, v) in httpResponse.allHeaderFields {
            responseHeaders[String(describing: k)] = String(describing: v)
          }
          let bodyStr = String(data: data, encoding: .utf8) ?? ""
          let fetchResponse = SyncFetchResponse(
            url: httpResponse.url?.absoluteString ?? url,
            status: Double(httpResponse.statusCode),
            statusText: HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode),
            headers: responseHeaders,
            body: bodyStr
          )
          result = .success(fetchResponse)
        } catch {
          result = .failure(error)
        }
      } else {
        result = .failure(NSError(domain: "HybridNitroCronet", code: -1, userInfo: [NSLocalizedDescriptionKey: "Unknown error"]))
      }
      semaphore.signal()
    }

    task.resume()
    semaphore.wait()

    switch result! {
    case .success(let response):
      return response
    case .failure(let error):
      throw error
    }
  }
}
