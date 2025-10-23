import Foundation

/**
 * Helper class for simple, non-streaming fetch operations.
 * Used primarily for prefetch functionality where we need complete responses.
 */
final class SimpleFetch {
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

  /**
   * Perform a simple fetch that accumulates the entire response body.
   * This is suitable for prefetch operations where we need the complete response.
   */
  static func fetch(
    url: String,
    method: String = "GET",
    headers: [String: String]? = nil,
    body: Data? = nil,
    maxAgeMs: Int64 = 5_000,
    completion: @escaping (Result<CachedResponse, Error>) -> Void
  ) {
    guard let urlObj = URL(string: url) else {
      completion(.failure(NSError(
        domain: "SimpleFetch",
        code: -1,
        userInfo: [NSLocalizedDescriptionKey: "Invalid URL: \(url)"]
      )))
      return
    }

    var request = URLRequest(url: urlObj)
    request.httpMethod = method

    if let headers = headers {
      for (key, value) in headers {
        request.addValue(value, forHTTPHeaderField: key)
      }
    }

    if let body = body {
      request.httpBody = body
    }

    let task = session.dataTask(with: request) { data, response, error in
      if let error = error {
        completion(.failure(error))
        return
      }

      guard let httpResponse = response as? HTTPURLResponse else {
        completion(.failure(NSError(
          domain: "SimpleFetch",
          code: -2,
          userInfo: [NSLocalizedDescriptionKey: "Invalid response"]
        )))
        return
      }

      guard let data = data else {
        completion(.failure(NSError(
          domain: "SimpleFetch",
          code: -3,
          userInfo: [NSLocalizedDescriptionKey: "No data received"]
        )))
        return
      }

      // Convert headers to dictionary
      var headersDict: [String: String] = [:]
      for (key, value) in httpResponse.allHeaderFields {
        if let keyStr = key as? String {
          headersDict[keyStr] = String(describing: value)
        }
      }

      let cached = CachedResponse(
        url: httpResponse.url?.absoluteString ?? url,
        statusCode: httpResponse.statusCode,
        statusText: HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode),
        headers: headersDict,
        body: data,
        timestampMs: Int64(Date().timeIntervalSince1970 * 1000),
        maxAgeMs: maxAgeMs
      )

      completion(.success(cached))
    }

    task.resume()
  }

  /**
   * Perform a prefetch with a specific prefetch key.
   * Handles cache checking and deduplication automatically.
   */
  static func prefetch(
    url: String,
    method: String = "GET",
    headers: [String: String]? = nil,
    body: Data? = nil,
    prefetchKey: String,
    maxAgeMs: Int64 = 5_000,
    completion: @escaping (Result<Void, Error>) -> Void
  ) {
    // Check if already have a fresh result
    if FetchCache.getResultIfFresh(prefetchKey, maxAgeMs: maxAgeMs) != nil {
      completion(.success(()))
      return
    }

    // Check if already pending
    if FetchCache.getPending(prefetchKey) {
      // Just wait for the existing request to complete
      FetchCache.addPending(prefetchKey) { result in
        switch result {
        case .success:
          completion(.success(()))
        case .failure(let error):
          completion(.failure(error))
        }
      }
      return
    }

    // Mark as pending
    FetchCache.setPending(prefetchKey)

    // Add prefetchKey to headers
    var allHeaders = headers ?? [:]
    allHeaders["prefetchKey"] = prefetchKey

    // Start the fetch
    fetch(
      url: url,
      method: method,
      headers: allHeaders,
      body: body,
      maxAgeMs: maxAgeMs
    ) { result in
      switch result {
      case .success(let cachedResponse):
        FetchCache.complete(prefetchKey, with: .success(cachedResponse))
        completion(.success(()))
      case .failure(let error):
        FetchCache.complete(prefetchKey, with: .failure(error))
        completion(.failure(error))
      }
    }
  }
}
