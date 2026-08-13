import Foundation
import NitroModules
import os
import UniformTypeIdentifiers

#if NITROFETCH_TRACING
private let fetchLog = OSLog(subsystem: "com.margelo.nitrofetch", category: "network")
#endif

final class HybridNitroFetchClient: HybridNitroFetchClientSpec {

  private var _lock = os_unfair_lock()
  private var activeTasks: [String: Task<Void, Never>] = [:]

  private func storeTask(_ task: Task<Void, Never>, forKey key: String) {
    os_unfair_lock_lock(&_lock)
    activeTasks[key] = task
    os_unfair_lock_unlock(&_lock)
  }

  private func removeTask(forKey key: String) {
    os_unfair_lock_lock(&_lock)
    activeTasks.removeValue(forKey: key)
    os_unfair_lock_unlock(&_lock)
  }

  func cancelRequest(requestId: String) throws {
    os_unfair_lock_lock(&_lock)
    let task = activeTasks.removeValue(forKey: requestId)
    os_unfair_lock_unlock(&_lock)
    task?.cancel()
  }

  func requestSync(req: NitroRequest) throws -> NitroResponse {
    let semaphore = DispatchSemaphore(value: 0)
    var result: Result<NitroResponse, Error>?
    let bodyData = HybridNitroFetchClient.uploadData(from: req)

    Task {
      do {
        let response = try await HybridNitroFetchClient.requestStatic(req, bodyData: bodyData)
        result = .success(response)
      } catch {
        result = .failure(error)
      }
      semaphore.signal()
    }
    
    semaphore.wait()
    
    switch result! {
    case .success(let response):
      return response
    case .failure(let error):
      throw error
    }
  }
  
  // Async version - returns Promise<NitroResponse>
  func request(req: NitroRequest) throws -> Promise<NitroResponse> {
    let promise = Promise<NitroResponse>.init()
    let requestId = req.requestId
    let bodyData = HybridNitroFetchClient.uploadData(from: req)

    let task = Task { [weak self] in
      defer {
        if let rid = requestId {
          self?.removeTask(forKey: rid)
        }
      }
      do {
        let response = try await HybridNitroFetchClient.requestStatic(req, bodyData: bodyData)
        promise.resolve(withResult: response)
      } catch {
        promise.reject(withError: error)
      }
    }

    if let rid = requestId {
      storeTask(task, forKey: rid)
    }
    return promise
  }
  
  func prefetch(req: NitroRequest) throws -> Promise<Void> {
    let promise = Promise<Void>.init()
    let bodyData = HybridNitroFetchClient.uploadData(from: req)
    Task {
      do {
        try await HybridNitroFetchClient.prefetchStatic(req, bodyData: bodyData)
        promise.resolve(withResult: ())
      } catch {
        promise.reject(withError: error)
      }
      
    }
    return promise
  }
  
  // Shared URLSession for static operations
  private static let session: URLSession = {
    let config = URLSessionConfiguration.default
    config.requestCachePolicy = .useProtocolCachePolicy
    config.urlCache = NitroURLCache.shared
    return NitroURLSession.make(configuration: config)
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


  // Must be called on the JS thread: a JS-owned ArrayBuffer is only valid for the synchronous call.
  static func uploadData(from req: NitroRequest) -> Data? {
    if let ab = req.bodyBytes { return ab.toData(copyIfNeeded: true) }
    return base64Data(from: req)
  }

  // Thread-safe: the auto-prefetch queue replays bytes as base64, never as an ArrayBuffer.
  private static func base64Data(from req: NitroRequest) -> Data? {
    guard let b64 = req.bodyBytesBase64, !b64.isEmpty else { return nil }
    return Data(base64Encoded: b64, options: .ignoreUnknownCharacters)
  }

  public class func requestStatic(_ req: NitroRequest, bodyData: Data? = nil) async throws -> NitroResponse {
    // Local resources (file://, scheme-less paths) aren't HTTP; read off disk -> 200.
    if !isHttpURL(req.url) {
      return try makeLocalFileResponse(req)
    }
    if let key = findPrefetchKey(req) {
      // If a prefetched result is fresh, return immediately
      if let cached = FetchCache.getResultIfFresh(key, maxAgeMs: Int64(req.prefetchCacheTtlMs ?? 5_000)) {
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

      if FetchCache.getPending(key) {
        let joined: NitroResponse? = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<NitroResponse?, Error>) in
          let attached = FetchCache.joinPending(key) { result in
            switch result {
            case .success(let res):
              continuation.resume(returning: res)
            case .failure(let err):
              continuation.resume(throwing: err)
            }
          }

          if !attached {
            continuation.resume(returning: FetchCache.getResultIfFresh(key, maxAgeMs: Int64(req.prefetchCacheTtlMs ?? 5_000)))
          }
        }
        if let res = joined {
          // Mirror Android: mark response as coming from prefetch
          var headers = res.headers ?? []
          headers.append(NitroHeader(key: "nitroPrefetched", value: "true"))
          return NitroResponse(url: res.url,
                               status: res.status,
                               statusText: res.statusText,
                               ok: res.ok,
                               redirected: res.redirected,
                               headers: headers,
                               bodyString: res.bodyString,
                               bodyBytes: res.bodyBytes)
        }
      }
    }

    let (urlRequest, finalURL) = try await buildURLRequest(req, bodyData: bodyData)
    let shouldFollowRedirects = req.followRedirects ?? true
    let delegate: URLSessionTaskDelegate? = shouldFollowRedirects ? nil : NoRedirectDelegate()

    #if NITROFETCH_TRACING
    let signpostID = OSSignpostID(log: fetchLog)
    let traceMethod = req.method?.stringValue ?? "GET"
    let tracePath = URL(string: req.url)?.path ?? req.url
    os_signpost(.begin, log: fetchLog, name: "NitroFetch", signpostID: signpostID,
                "%{public}s %{public}s", traceMethod, tracePath)
    #endif

    // DevTools/CDP reporting is gated on `#if DEBUG` so the entire block is
    // compiled out of release builds — no runtime cost, no symbol references.
    #if DEBUG
    let devToolsId = req.requestId ?? UUID().uuidString
    if NitroDevToolsReporter.isDebuggingEnabled() {
      NitroDevToolsReporter.reportRequestStart(withRequest: devToolsId, request: urlRequest)
    }
    #endif

    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: urlRequest, delegate: delegate)
    } catch {
      #if DEBUG
      if NitroDevToolsReporter.isDebuggingEnabled() {
        let cancelled = (error as NSError).code == NSURLErrorCancelled
        NitroDevToolsReporter.reportRequestFailed(devToolsId, cancelled: cancelled)
      }
      #endif
      throw error
    }
    guard let http = response as? HTTPURLResponse else {
      #if DEBUG
      if NitroDevToolsReporter.isDebuggingEnabled() {
        NitroDevToolsReporter.reportRequestFailed(devToolsId, cancelled: false)
      }
      #endif
      throw NSError(domain: "NitroFetch", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
    }

    let headersPairs: [NitroHeader] = http.allHeaderFields.compactMap { k, v in
      guard let key = k as? String else { return nil }
      return NitroHeader(key: key, value: String(describing: v))
    }

    #if DEBUG
    if NitroDevToolsReporter.isDebuggingEnabled() {
      var headerDict: [String: String] = [:]
      for h in headersPairs { headerDict[h.key] = h.value }
      NitroDevToolsReporter.reportResponseStart(
        devToolsId,
        url: finalURL?.absoluteString ?? http.url?.absoluteString ?? req.url,
        statusCode: http.statusCode,
        headers: headerDict
      )
      NitroDevToolsReporter.reportDataReceived(devToolsId, length: data.count)
      if NitroDevToolsReporter.isTextualContentType(headerDict["Content-Type"] ?? headerDict["content-type"]) {
        // Use the incremental/text API for textual bodies — the byte-based
        // `storeResponseBody` path goes through CDP as base64 regardless of
        // the flag, which makes the DevTools Response panel show base64.
        if let text = String(data: data, encoding: .utf8) {
          NitroDevToolsReporter.storeResponseBodyIncremental(devToolsId, text: text)
        }
      } else if data.count > 0 && data.count <= 5 * 1024 * 1024 {
        NitroDevToolsReporter.storeResponseBody(devToolsId, data: data, base64Encoded: true)
      }
      NitroDevToolsReporter.reportResponseEnd(devToolsId, encodedDataLength: data.count)
    }
    #endif

    // Choose bodyString by default (matching Android’s first pass).
    // For binary responses that can’t be decoded as text, bridge the raw bytes
    // as an ArrayBuffer so arrayBuffer() / bytes() return them with no base64.
    let charset = HybridNitroFetchClient.detectCharset(from: http) ?? String.Encoding.utf8
    let bodyStr = String(data: data, encoding: charset) ?? String(data: data, encoding: .utf8)
    var bodyBytesAb: ArrayBuffer? = nil
    if bodyStr == nil && !data.isEmpty {
      bodyBytesAb = try ArrayBuffer.copy(data: data)
    }

    let res = NitroResponse(
      url: finalURL?.absoluteString ?? http.url?.absoluteString ?? req.url,
      status: Double(http.statusCode),
      statusText: HTTPURLResponse.localizedString(forStatusCode: http.statusCode),
      ok: (200...299).contains(http.statusCode),
      redirected: (finalURL?.absoluteString ?? http.url?.absoluteString ?? req.url) != req.url,
      headers: headersPairs,
      bodyString: bodyStr,
      bodyBytes: bodyBytesAb
    )

    // Do not write to cache here; only prefetch should populate the cache

    #if NITROFETCH_TRACING
    os_signpost(.end, log: fetchLog, name: "NitroFetch", signpostID: signpostID,
                "status=%d bytes=%d", http.statusCode, data.count)
    #endif

    return res
  }

  public class func prefetchStatic(_ req: NitroRequest, bodyData: Data? = nil) async throws {
    guard let key = findPrefetchKey(req) else {
      throw NSError(domain: "NitroFetch", code: -2, userInfo: [NSLocalizedDescriptionKey: "prefetch: missing 'prefetchKey' header"])
    }

    if FetchCache.getResultIfFresh(key, maxAgeMs: Int64(req.prefetchCacheTtlMs ?? 5_000)) != nil {
      return // already have a fresh result
    }

    // Mark pending and start the request. beginPending is atomic, so two racing
    // prefetches for the same key cannot both start one.
    guard FetchCache.beginPending(key) else {
      return // already pending
    }
    Task.detached {
      do {
        let (urlRequest, finalURL) = try await buildURLRequest(req, bodyData: bodyData)
        let (data, response) = try await session.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse else {
          throw NSError(domain: "NitroFetch", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
        }
        let headersPairs: [NitroHeader] = http.allHeaderFields.compactMap { k, v in
          guard let key = k as? String else { return nil }
          return NitroHeader(key: key, value: String(describing: v))
        }
        let charset = HybridNitroFetchClient.detectCharset(from: http) ?? .utf8
        let bodyStr = String(data: data, encoding: charset) ?? String(data: data, encoding: .utf8)
        var bodyBytesAb: ArrayBuffer? = nil
        if bodyStr == nil && !data.isEmpty {
          bodyBytesAb = try ArrayBuffer.copy(data: data)
        }
        let res = NitroResponse(
          url: finalURL?.absoluteString ?? http.url?.absoluteString ?? req.url,
          status: Double(http.statusCode),
          statusText: HTTPURLResponse.localizedString(forStatusCode: http.statusCode),
          ok: (200...299).contains(http.statusCode),
          redirected: (finalURL?.absoluteString ?? http.url?.absoluteString ?? req.url) != req.url,
          headers: headersPairs,
          bodyString: bodyStr,
          bodyBytes: bodyBytesAb
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

  private static func buildURLRequest(_ req: NitroRequest, bodyData: Data? = nil) async throws -> (URLRequest, URL?) {
    guard let url = URL(string: req.url) else {
      throw NSError(domain: "NitroFetch", code: -3, userInfo: [NSLocalizedDescriptionKey: "Invalid URL: \(req.url)"])
    }
    var r = URLRequest(url: url)
    if let m = req.method?.rawValue { r.httpMethod = reqToHttpMethod(req) }
    if let headers = req.headers {
      // `prefetchKey` is an internal cache key, not a request header — every
      // caller that needs it has already read it off the original NitroRequest
      // via findPrefetchKey() before reaching this point, so it must not go out
      // on the wire.
      for h in headers where h.key.caseInsensitiveCompare("prefetchKey") != .orderedSame {
        r.addValue(h.value, forHTTPHeaderField: h.key)
      }
    }
    if let parts = req.bodyFormData, !parts.isEmpty {
      let (body, contentType) = try await buildMultipartBody(parts)
      r.httpBody = body
      r.setValue(contentType, forHTTPHeaderField: "Content-Type")
    } else if let bytes = bodyData ?? base64Data(from: req) {
      r.httpBody = bytes
    } else if let s = req.bodyString {
      r.httpBody = s.data(using: .utf8)
    }
    if let t = req.timeoutMs, t > 0 { r.timeoutInterval = TimeInterval(t) / 1000.0 }
    if req.credentials == .omit { r.httpShouldHandleCookies = false }
    return (r, nil)
  }

  private static func buildMultipartBody(_ parts: [NitroFormDataPart]) async throws -> (Data, String) {
    let boundary = "NitroFetch-\(UUID().uuidString)"
    var body = Data()
    let crlf = "\r\n"

    for part in parts {
      body.append("--\(boundary)\(crlf)".data(using: .utf8)!)

      if let fileUri = part.fileUri {
        let fileName = part.fileName ?? "file"
        let mimeType = part.mimeType ?? "application/octet-stream"
        body.append("Content-Disposition: form-data; name=\"\(part.name)\"; filename=\"\(fileName)\"\(crlf)".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\(crlf)\(crlf)".data(using: .utf8)!)

        let fileData = try await readFileData(fileUri)
        body.append(fileData)
      } else {
        let value = part.value ?? ""
        body.append("Content-Disposition: form-data; name=\"\(part.name)\"\(crlf)\(crlf)".data(using: .utf8)!)
        body.append(value.data(using: .utf8)!)
      }

      body.append(crlf.data(using: .utf8)!)
    }

    body.append("--\(boundary)--\(crlf)".data(using: .utf8)!)
    return (body, "multipart/form-data; boundary=\(boundary)")
  }

  private static func readFileData(_ uri: String) async throws -> Data {
    if uri.hasPrefix("http://") || uri.hasPrefix("https://") {
      guard let url = URL(string: uri) else {
        throw NSError(domain: "NitroFetch", code: -4, userInfo: [NSLocalizedDescriptionKey: "Invalid URL: \(uri)"])
      }
      let (data, _) = try await session.data(from: url)
      return data
    }
    return try localData(forURI: uri)
  }

  private static func isHttpURL(_ url: String) -> Bool {
    return url.hasPrefix("http://") || url.hasPrefix("https://")
  }

  // Some files are % encoded we need to convert it to correct format
  private static func localPath(forURI uri: String) -> String {
    guard uri.hasPrefix("file://") else { return uri }
    if let url = URL(string: uri), url.isFileURL { return url.path }
    return String(uri.dropFirst(7))
  }

  private static func localData(forURI uri: String) throws -> Data {
    guard let data = FileManager.default.contents(atPath: localPath(forURI: uri)) else {
      throw NSError(domain: "NitroFetch", code: -4,
                    userInfo: [NSLocalizedDescriptionKey: "Cannot read file at: \(uri)"])
    }
    return data
  }

  private static func mimeType(forURI uri: String) -> String {
    let path = localPath(forURI: uri)
    let ext = (path as NSString).pathExtension
    if !ext.isEmpty, let type = UTType(filenameExtension: ext),
       let mime = type.preferredMIMEType {
      return mime
    }
    return "application/octet-stream"
  }

  // Read a local file -> synthetic 200, mirroring the HTTP path's text/bytes choice.
  private static func makeLocalFileResponse(_ req: NitroRequest) throws -> NitroResponse {
    let data = try localData(forURI: req.url)
    let mime = mimeType(forURI: req.url)
    let bodyStr = String(data: data, encoding: .utf8)
    var bodyBytesAb: ArrayBuffer? = nil
    if bodyStr == nil && !data.isEmpty {
      bodyBytesAb = try ArrayBuffer.copy(data: data)
    }
    return NitroResponse(
      url: req.url,
      status: 200,
      statusText: "OK",
      ok: true,
      redirected: false,
      headers: [
        NitroHeader(key: "Content-Type", value: mime),
        NitroHeader(key: "Content-Length", value: String(data.count)),
      ],
      bodyString: bodyStr,
      bodyBytes: bodyBytesAb
    )
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

/// Delegate that prevents URLSession from following HTTP redirects.
/// When the completion handler receives `nil`, the 3xx response is returned as-is.
final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate {
  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping @Sendable (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
}
