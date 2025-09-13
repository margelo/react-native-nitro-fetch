import Foundation

@objc
final class NitroFetchClient: HybridNitroFetchClientSpec {
  // Shared URLSession for static operations
  private static let session: URLSession = {
    let config = URLSessionConfiguration.default
    config.requestCachePolicy = .useProtocolCachePolicy
    config.urlCache = URLCache(memoryCapacity: 32 * 1024 * 1024,
                               diskCapacity: 100 * 1024 * 1024,
                               diskPath: "nitrofetch_urlcache")
    return URLSession(configuration: config)
  }()

  private func findPrefetchKey(_ req: NitroRequest) -> String? {
    guard let headers = req.headers else { return nil }
    for h in headers {
      if h.key.caseInsensitiveCompare("prefetchKey") == .orderedSame {
        return h.value
      }
    }
    return nil
  }

  // Instance override delegates to static implementation.
  override func request(_ req: NitroRequest) async throws -> NitroResponse {
    return try await NitroFetchClient.requestStatic(req)
  }

  // Instance override delegates to static implementation.
  override func prefetch(_ req: NitroRequest) async throws {
    try await NitroFetchClient.prefetchStatic(req)
  }

  // MARK: - Static API usable from native bootstrap

  @objc
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

    if let key = findPrefetchKey(req) {
      // If this request was a prefetched one (or consumer of it), mark as prefetched if we had a pending prefetch
      // and store the fresh result for a short time to be reused.
      FetchCache.complete(key, with: .success(res))
    }

    return res
  }

  @objc
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

  private static func buildURLRequest(_ req: NitroRequest) throws -> (URLRequest, URL?) {
    guard let url = URL(string: req.url) else {
      throw NSError(domain: "NitroFetch", code: -3, userInfo: [NSLocalizedDescriptionKey: "Invalid URL: \(req.url)"])
    }
    var r = URLRequest(url: url)
    if let m = req.method?.rawValue { r.httpMethod = m }
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
