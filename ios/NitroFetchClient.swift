import Foundation
import NitroModules

final class NitroFetchClient: HybridNitroFetchClientSpec {
  func request(req: NitroRequest) throws -> Promise<NitroResponse> {
    let promise = Promise<NitroResponse>.init()
    Task {
      do {
        let response = try await NitroFetchClient.requestStatic(req)
        promise.resolve(withResult: response)
      } catch {
        promise.reject(withError: error)
      }
    }
    return promise
  }
  
  func prefetch(req: NitroRequest) throws -> Promise<Void> {
    let promise = Promise<Void>.init()
    Task {
      do {
        try await NitroFetchClient.prefetchStatic(req)
        promise.resolve(withResult: ())
      } catch {
        promise.reject(withError: error)
      }
      
    }
    return promise
  }
  
  func getNetworkQualityEstimate() throws -> NetworkQualityEstimate {
    // NQE is not supported on iOS yet - requires Cronet integration
    NSLog("[NitroFetch] Network Quality Estimator (NQE) is not supported on iOS yet. It will be available once iOS uses Cronet.")
    
    // Return empty estimate
    return NetworkQualityEstimate(
      downstreamThroughputKbps: nil,
      upstreamThroughputKbps: nil,
      httpRttMs: nil,
      transportRttMs: nil,
      effectiveConnectionType: "unknown"
    )
  }
  
  // Shared URLSession for static operations
  private static let session: URLSession = {
    let config = URLSessionConfiguration.default
    config.requestCachePolicy = .useProtocolCachePolicy
    config.urlCache = URLCache(memoryCapacity: 32 * 1024 * 1024,
                               diskCapacity: 100 * 1024 * 1024,
                               diskPath: "nitrofetch_urlcache")
    return URLSession(configuration: config)
  }()

  private static func findPrefetchKey(_ req: NitroRequest) -> String? {
    guard let headers = req.headers else { return nil }
    for h in headers {
      if h.key.caseInsensitiveCompare("prefetchKey") == .orderedSame {
        return h.value
      }
    }
    return nil
  }

  // MARK: - Static API usable from native bootstrap


  public class func requestStatic(_ req: NitroRequest) async throws -> NitroResponse {
    if let key = findPrefetchKey(req) {
      // If a prefetched result is fresh, return immediately
      if let cached = FetchCache.getResultIfFresh(key, maxAgeMs: 5_000) {
        var headers = cached.headers ?? []
        headers.append(NitroHeader(key: "nitroPrefetched", value: "true"))
        return NitroResponse(url: cached.url,
                             status: cached.status,
                             statusText: cached.statusText,
                             ok: cached.ok,
                             redirected: cached.redirected,
                             headers: headers,
                             bodyString: cached.bodyString,
                             bodyBytes: cached.bodyBytes)
      }

      // If a prefetch is already pending, await and reuse its result
      if FetchCache.getPending(key) {
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<NitroResponse, Error>) in
          FetchCache.addPending(key) { result in
            switch result {
            case .success(let res):
              // Mirror Android: mark response as coming from prefetch
              var headers = res.headers ?? []
              headers.append(NitroHeader(key: "nitroPrefetched", value: "true"))
              let wrapped = NitroResponse(url: res.url,
                                          status: res.status,
                                          statusText: res.statusText,
                                          ok: res.ok,
                                          redirected: res.redirected,
                                          headers: headers,
                                          bodyString: res.bodyString,
                                          bodyBytes: res.bodyBytes)
              continuation.resume(returning: wrapped)
            case .failure(let err):
              continuation.resume(throwing: err)
            }
          }
        }
      }
    }

    let (urlRequest, finalURL) = try buildURLRequest(req)
    let (data, response) = try await session.data(for: urlRequest)
    guard let http = response as? HTTPURLResponse else {
      throw NSError(domain: "NitroFetch", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
    }

    let headersPairs: [NitroHeader] = http.allHeaderFields.compactMap { k, v in
      guard let key = k as? String else { return nil }
      return NitroHeader(key: key, value: String(describing: v))
    }

    // Choose bodyString by default (matching Android’s first pass)
    let charset = NitroFetchClient.detectCharset(from: http) ?? String.Encoding.utf8
    let bodyStr = String(data: data, encoding: charset) ?? String(data: data, encoding: .utf8)

    let res = NitroResponse(
      url: finalURL?.absoluteString ?? http.url?.absoluteString ?? req.url,
      status: Double(http.statusCode),
      statusText: HTTPURLResponse.localizedString(forStatusCode: http.statusCode),
      ok: (200...299).contains(http.statusCode),
      redirected: (finalURL?.absoluteString ?? http.url?.absoluteString ?? req.url) != req.url,
      headers: headersPairs,
      bodyString: bodyStr,
      bodyBytes: nil
    )

    // Do not write to cache here; only prefetch should populate the cache

    return res
  }

  public class func prefetchStatic(_ req: NitroRequest) async throws {
    guard let key = findPrefetchKey(req) else {
      throw NSError(domain: "NitroFetch", code: -2, userInfo: [NSLocalizedDescriptionKey: "prefetch: missing 'prefetchKey' header"])
    }

    if FetchCache.getResultIfFresh(key, maxAgeMs: 5_000) != nil {
      return // already have a fresh result
    }

    if FetchCache.getPending(key) {
      return // already pending
    }

    // Mark pending and start the request
    FetchCache.addPending(key) { _ in /* ignored here */ }
    Task.detached {
      do {
        let (urlRequest, finalURL) = try buildURLRequest(req)
        let (data, response) = try await session.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse else {
          throw NSError(domain: "NitroFetch", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
        }
        let headersPairs: [NitroHeader] = http.allHeaderFields.compactMap { k, v in
          guard let key = k as? String else { return nil }
          return NitroHeader(key: key, value: String(describing: v))
        }
        let charset = NitroFetchClient.detectCharset(from: http) ?? .utf8
        let bodyStr = String(data: data, encoding: charset) ?? String(data: data, encoding: .utf8)
        let res = NitroResponse(
          url: finalURL?.absoluteString ?? http.url?.absoluteString ?? req.url,
          status: Double(http.statusCode),
          statusText: HTTPURLResponse.localizedString(forStatusCode: http.statusCode),
          ok: (200...299).contains(http.statusCode),
          redirected: (finalURL?.absoluteString ?? http.url?.absoluteString ?? req.url) != req.url,
          headers: headersPairs,
          bodyString: bodyStr,
          bodyBytes: nil
        )
        FetchCache.complete(key, with: .success(res))
      } catch {
        FetchCache.complete(key, with: .failure(error))
      }
    }
  }
  
  private static func reqToHttpMethod(_ req: NitroRequest) -> String? {
    return req.method?.stringValue
  }

  private static func buildURLRequest(_ req: NitroRequest) throws -> (URLRequest, URL?) {
    guard let url = URL(string: req.url) else {
      throw NSError(domain: "NitroFetch", code: -3, userInfo: [NSLocalizedDescriptionKey: "Invalid URL: \(req.url)"])
    }
    var r = URLRequest(url: url)
    if let m = req.method?.rawValue { r.httpMethod = reqToHttpMethod(req) }
    if let headers = req.headers {
      for h in headers { r.addValue(h.value, forHTTPHeaderField: h.key) }
    }
    if let s = req.bodyString {
      r.httpBody = s.data(using: .utf8)
    }
    if let t = req.timeoutMs, t > 0 { r.timeoutInterval = TimeInterval(t) / 1000.0 }
    return (r, nil)
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
