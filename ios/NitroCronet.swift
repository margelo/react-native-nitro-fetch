import Foundation
import NitroModules

/**
 * Main Nitro Cronet factory class for iOS.
 * Note: iOS uses URLSession instead of Cronet, but provides compatible interface.
 */
final class NitroCronet: HybridNitroCronetSpec {

  private static let sharedEngine = NitroCronetEngine()

  func getEngine() throws -> any HybridCronetEngineSpec {
    return NitroCronet.sharedEngine
  }

  func createEngine() throws -> any HybridCronetEngineSpec {
    return NitroCronet.sharedEngine
  }

  func shutdownAll() throws {
    // iOS URLSession doesn't need explicit shutdown
    // But we can invalidate sessions if needed
    NitroCronet.sharedEngine.invalidateSession()
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
    guard let prefetchKey = headers.first(where: { $0.key.caseInsensitiveCompare("prefetchKey") == .orderedSame })?.value,
          !prefetchKey.isEmpty else {
      promise.reject(withError: NSError(
        domain: "NitroCronet",
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

    // Start new prefetch
    FetchCache.addPending(prefetchKey) { _ in }

    Task.detached {
      do {
        guard let requestUrl = URL(string: url) else {
          throw NSError(domain: "NitroCronet", code: -2, userInfo: [NSLocalizedDescriptionKey: "Invalid URL"])
        }

        var request = URLRequest(url: requestUrl)
        request.httpMethod = httpMethod

        for (key, value) in headers {
          request.addValue(value, forHTTPHeaderField: key)
        }

        // Handle body
        if let body = body {
          switch body {
          case .first(let arrayBuffer):
            // Convert ArrayBuffer to Data
            request.httpBody = arrayBuffer.toData(copyIfNeeded: true)
          case .second(let string):
            request.httpBody = string.data(using: .utf8)
          }
        }

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
          throw NSError(domain: "NitroCronet", code: -3, userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
        }

        var headersDict: [String: String] = [:]
        for (key, value) in httpResponse.allHeaderFields {
          if let keyStr = key as? String {
            headersDict[keyStr] = String(describing: value)
          }
        }

        let arrayBuffer = try ArrayBuffer.copy(data: data)
        let timestampMs = Double(Date().timeIntervalSince1970 * 1000)

        let cachedResponse = CachedPrefetchResponse(
          url: httpResponse.url?.absoluteString ?? url,
          statusCode: Double(httpResponse.statusCode),
          statusText: HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode),
          headers: headersDict,
          body: arrayBuffer,
          timestampMs: timestampMs
        )

        FetchCache.complete(prefetchKey, with: .success(cachedResponse))
        promise.resolve(withResult: ())
      } catch {
        FetchCache.complete(prefetchKey, with: .failure(error))
        promise.reject(withError: error)
      }
    }

    return promise
  }

  func consumeNativePrefetch(prefetchKey: String) throws -> Promise<CachedFetchResponse?> {
    let promise = Promise<CachedFetchResponse?>()

    // First, try to get a fresh cached result (non-blocking)
    if let cached = FetchCache.getResultIfFresh(prefetchKey, maxAgeMs: Int64.max) {
      var headers = cached.headers
      headers["nitroPrefetched"] = "true"

      let result = CachedFetchResponse(
        url: cached.url,
        status: cached.statusCode,
        statusText: cached.statusText,
        headers: headers,
        body: cached.body
      )

      promise.resolve(withResult: result)
      return promise
    }

    // Check if a prefetch is pending
    if FetchCache.getPending(prefetchKey) {
      FetchCache.addPending(prefetchKey) { result in
        switch result {
        case .success(let cached):
          var headers = cached.headers
          headers["nitroPrefetched"] = "true"

          let fetchResponse = CachedFetchResponse(
            url: cached.url,
            status: cached.statusCode,
            statusText: cached.statusText,
            headers: headers,
            body: cached.body
          )
          promise.resolve(withResult: fetchResponse)
        case .failure(let error):
          promise.reject(withError: error)
        }
      }
      return promise
    }

    // Not found in cache and not pending - reject
    promise.reject(withError: NSError(
      domain: "NitroCronet",
      code: -4,
      userInfo: [NSLocalizedDescriptionKey: "No prefetch found for key: \(prefetchKey)"]
    ))
    return promise
  }

  private static func detectCharset(from http: HTTPURLResponse) -> String.Encoding? {
    if let ct = http.value(forHTTPHeaderField: "Content-Type")?.lowercased() {
      if let range = ct.range(of: "charset=") {
        let charset = String(ct[range.upperBound...]).trimmingCharacters(in: .whitespaces)
        let mapped = CFStringConvertIANACharSetNameToEncoding(charset as CFString)
        if mapped != kCFStringEncodingInvalidId {
          return String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(mapped))
        }
      }
    }
    return nil
  }
}
