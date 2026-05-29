import Foundation

@objc(NitroAutoPrefetcher)
public final class NitroAutoPrefetcher: NSObject {
  private static var initialized = false
  private static let queueKey = "nitrofetch_autoprefetch_queue"
  private static let suiteName = "nitro_fetch_storage"
  private static let tokenRefreshKey = "nitro_token_refresh_fetch"
  private static let tokenCacheKey = "nitro_token_refresh_fetch_cache"

  /// Register a URL to prefetch on app start. Call from
  /// `application(_:didFinishLaunchingWithOptions:)`. Writes to the same
  /// persistent queue used by the JS `prefetchOnAppStart` API; entries are
  /// deduped by `prefetchKey`.
  ///
  /// If called after `prefetchOnStart` already ran (late registration), the
  /// entry is also kicked immediately via `NitroFetchClient.prefetchStatic`.
  @objc
  public static func registerPrefetch(
    url: String,
    prefetchKey: String,
    headers: [String: String]
  ) {
    registerPrefetchInternal(
      url: url, prefetchKey: prefetchKey, headers: headers,
      method: nil, bodyString: nil, bodyBytes: nil,
      bodyFormData: nil, timeoutMs: nil, followRedirects: nil,
      prefetchCacheTtlMs: nil
    )
  }

  @objc(registerPrefetchWithURL:prefetchKey:headers:method:bodyString:bodyBytes:bodyFormData:timeoutMs:followRedirects:)
  public static func registerPrefetch(
    url: String,
    prefetchKey: String,
    headers: [String: String],
    method: String?,
    bodyString: String?,
    bodyBytes: String?,
    bodyFormData: [[String: String]]?,
    timeoutMs: NSNumber?,
    followRedirects: NSNumber?
  ) {
    registerPrefetchInternal(
      url: url, prefetchKey: prefetchKey, headers: headers,
      method: method, bodyString: bodyString, bodyBytes: bodyBytes,
      bodyFormData: bodyFormData,
      timeoutMs: timeoutMs?.doubleValue,
      followRedirects: followRedirects?.boolValue,
      prefetchCacheTtlMs: nil
    )
  }

  @objc(registerPrefetchWithURL:prefetchKey:headers:method:bodyString:bodyBytes:bodyFormData:timeoutMs:followRedirects:prefetchCacheTtlMs:)
  public static func registerPrefetch(
    url: String,
    prefetchKey: String,
    headers: [String: String],
    method: String?,
    bodyString: String?,
    bodyBytes: String?,
    bodyFormData: [[String: String]]?,
    timeoutMs: NSNumber?,
    followRedirects: NSNumber?,
    prefetchCacheTtlMs: NSNumber?
  ) {
    registerPrefetchInternal(
      url: url, prefetchKey: prefetchKey, headers: headers,
      method: method, bodyString: bodyString, bodyBytes: bodyBytes,
      bodyFormData: bodyFormData,
      timeoutMs: timeoutMs?.doubleValue,
      followRedirects: followRedirects?.boolValue,
      prefetchCacheTtlMs: prefetchCacheTtlMs?.doubleValue
    )
  }

  private static func registerPrefetchInternal(
    url: String,
    prefetchKey: String,
    headers: [String: String],
    method: String?,
    bodyString: String?,
    bodyBytes: String?,
    bodyFormData: [[String: String]]?,
    timeoutMs: Double?,
    followRedirects: Bool?,
    prefetchCacheTtlMs: Double?
  ) {
    if url.isEmpty || prefetchKey.isEmpty { return }
    let entry = buildEntryDict(
      url: url, prefetchKey: prefetchKey, headers: headers,
      method: method, bodyString: bodyString, bodyBytes: bodyBytes,
      bodyFormData: bodyFormData, timeoutMs: timeoutMs,
      followRedirects: followRedirects,
      prefetchCacheTtlMs: prefetchCacheTtlMs
    )
    let userDefaults = UserDefaults(suiteName: suiteName) ?? UserDefaults.standard

    var arr: [[String: Any]] = []
    if let raw = userDefaults.string(forKey: queueKey),
       !raw.isEmpty,
       let data = raw.data(using: .utf8),
       let parsed = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
      arr = parsed
    }
    arr.removeAll { ($0["prefetchKey"] as? String) == prefetchKey }
    arr.append(entry)
    if let data = try? JSONSerialization.data(withJSONObject: arr),
       let str = String(data: data, encoding: .utf8) {
      userDefaults.set(str, forKey: queueKey)
    }

    if initialized {
      // Late path — apply cached tokens + kick immediate prefetch
      let tokens = deserializeCache(
        NitroFetchSecureAtRest.decryptedString(forKey: tokenCacheKey, defaults: userDefaults))
      var merged: [String: String] = headers
      for (k, v) in tokens.headers { merged[k] = v }
      var hdrs: [NitroHeader] = merged.map { NitroHeader(key: $0.key, value: $0.value) }
      hdrs.append(NitroHeader(key: "prefetchKey", value: prefetchKey))
      let req = buildNitroRequest(from: entry, mergedHeaders: hdrs, tokens: tokens)
      Task {
        do { try await NitroFetchClient.prefetchStatic(req) } catch { /* best-effort */ }
      }
    }
  }

  @objc
  public static func prefetchOnStart() {
    if initialized { return }
    initialized = true

    let userDefaults = UserDefaults(suiteName: suiteName) ?? UserDefaults.standard
    guard let raw = userDefaults.string(forKey: queueKey), !raw.isEmpty else { return }
    guard let data = raw.data(using: .utf8) else { return }
    guard let arr = try? JSONSerialization.jsonObject(with: data, options: []) as? [Any] else { return }

    let refreshRaw = NitroFetchSecureAtRest.decryptedString(forKey: tokenRefreshKey, defaults: userDefaults)

    Task {
      // Resolve tokens (may require a network call)
      let tokens: TokenRefreshResult
      if let refreshRaw = refreshRaw,
         !refreshRaw.isEmpty,
         let refreshData = refreshRaw.data(using: .utf8),
         let refreshObj = try? JSONSerialization.jsonObject(with: refreshData) as? [String: Any] {
        let onFailure = refreshObj["onFailure"] as? String ?? "useStoredHeaders"
        let refreshURL = refreshObj["url"] as? String ?? "(unknown)"
        print("[NitroFetch][TokenRefresh] Calling refresh endpoint: \(refreshURL)")
        let refreshed = try? await callTokenRefresh(config: refreshObj)
        if let refreshed = refreshed {
          print("[NitroFetch][TokenRefresh] ✅ Success — got \(refreshed.headers.count) header(s)")
          for (k, v) in refreshed.headers { print("[NitroFetch][TokenRefresh]   \(k): \(v)") }
          // Cache fresh tokens for useStoredHeaders fallback on next cold start
          if let cacheStr = serializeCache(refreshed) {
            try? NitroFetchSecureAtRest.setEncrypted(cacheStr, forKey: tokenCacheKey, defaults: userDefaults)
          }
          tokens = refreshed
        } else {
          print("[NitroFetch][TokenRefresh] ❌ Refresh failed — onFailure: \(onFailure)")
          if onFailure == "skip" {
            print("[NitroFetch][TokenRefresh] Skipping all prefetches")
            return
          }
          let cached = deserializeCache(
            NitroFetchSecureAtRest.decryptedString(forKey: tokenCacheKey, defaults: userDefaults))
          print("[NitroFetch][TokenRefresh] Using cached headers (\(cached.headers.count) header(s))")
          tokens = cached
        }
      } else {
        tokens = .empty
      }

      // Launch a prefetch task per entry with merged headers + body/form injection
      print("[NitroFetch][TokenRefresh] Injecting token headers into \(arr.count) prefetch URL(s)")
      for item in arr {
        guard let obj = item as? [String: Any] else { continue }
        guard let url = obj["url"] as? String, !url.isEmpty else { continue }
        guard let prefetchKey = obj["prefetchKey"] as? String, !prefetchKey.isEmpty else { continue }
        let headersDict = (obj["headers"] as? [String: Any]) ?? [:]

        // Merge: static headers first, token headers override
        var merged: [String: String] = [:]
        for (k, v) in headersDict { merged[k] = String(describing: v) }
        for (k, v) in tokens.headers { merged[k] = v }

        var headers: [NitroHeader] = merged.map { NitroHeader(key: $0.key, value: $0.value) }
        headers.append(NitroHeader(key: "prefetchKey", value: prefetchKey))

        print("[NitroFetch][TokenRefresh] Prefetching \(url) with \(merged.count) header(s)")
        for (k, v) in merged { print("[NitroFetch][TokenRefresh]   \(k): \(v)") }

        let req = buildNitroRequest(from: obj, mergedHeaders: headers, tokens: tokens)
        Task {
          do { try await NitroFetchClient.prefetchStatic(req) } catch { /* ignore – best effort */ }
        }
      }
    }
  }

  private static func buildEntryDict(
    url: String,
    prefetchKey: String,
    headers: [String: String],
    method: String?,
    bodyString: String?,
    bodyBytes: String?,
    bodyFormData: [[String: String]]?,
    timeoutMs: Double?,
    followRedirects: Bool?,
    prefetchCacheTtlMs: Double? = nil
  ) -> [String: Any] {
    var entry: [String: Any] = [
      "url": url,
      "prefetchKey": prefetchKey,
      "headers": headers,
    ]
    if let method = method, !method.isEmpty, method != "GET" { entry["method"] = method }
    if let bodyString = bodyString { entry["bodyString"] = bodyString }
    if let bodyBytes = bodyBytes { entry["bodyBytes"] = bodyBytes }
    if let parts = bodyFormData, !parts.isEmpty {
      entry["bodyFormData"] = parts.map { part -> [String: String] in
        var clean: [String: String] = [:]
        if let v = part["name"] { clean["name"] = v }
        if let v = part["value"] { clean["value"] = v }
        if let v = part["fileUri"] { clean["fileUri"] = v }
        if let v = part["fileName"] { clean["fileName"] = v }
        if let v = part["mimeType"] { clean["mimeType"] = v }
        return clean
      }
    }
    if let timeoutMs = timeoutMs { entry["timeoutMs"] = timeoutMs }
    if followRedirects == false { entry["followRedirects"] = false }
    if let prefetchCacheTtlMs = prefetchCacheTtlMs { entry["prefetchCacheTtlMs"] = prefetchCacheTtlMs }
    return entry
  }

  private static func buildNitroRequest(
    from entry: [String: Any],
    mergedHeaders: [NitroHeader],
    tokens: TokenRefreshResult = .empty
  ) -> NitroRequest {
    let url = (entry["url"] as? String) ?? ""
    let methodStr = entry["method"] as? String
    let method: NitroRequestMethod? = methodStr.flatMap { NitroRequestMethod(fromString: $0) }
    let bodyString = injectBodyFields(entry["bodyString"] as? String, fields: tokens.bodyFields)
    let bodyBytes = entry["bodyBytes"] as? String
    let timeoutMs = (entry["timeoutMs"] as? NSNumber)?.doubleValue
    let followRedirects = (entry["followRedirects"] as? Bool) ?? true
    let prefetchCacheTtlMs = (entry["prefetchCacheTtlMs"] as? NSNumber)?.doubleValue

    let baseParts: [NitroFormDataPart] = (entry["bodyFormData"] as? [[String: Any]])?.map { p in
      NitroFormDataPart(
        name: (p["name"] as? String) ?? "",
        value: p["value"] as? String,
        fileUri: p["fileUri"] as? String,
        fileName: p["fileName"] as? String,
        mimeType: p["mimeType"] as? String
      )
    } ?? []
    let formData: [NitroFormDataPart]? = injectFormFields(baseParts, fields: tokens.formFields)

    return NitroRequest(
      url: url,
      method: method,
      headers: mergedHeaders,
      bodyString: bodyString,
      bodyBytes: bodyBytes,
      bodyFormData: formData,
      timeoutMs: timeoutMs,
      followRedirects: followRedirects,
      prefetchCacheTtlMs: prefetchCacheTtlMs,
      requestId: nil
    )
  }

  // MARK: - Token refresh

  struct TokenRefreshResult {
    var headers: [String: String]
    var bodyFields: [String: String]
    var formFields: [String: String]
    static let empty = TokenRefreshResult(headers: [:], bodyFields: [:], formFields: [:])
  }

  private static func callTokenRefresh(config: [String: Any]) async throws -> TokenRefreshResult {
    guard let urlStr = config["url"] as? String,
          let url = URL(string: urlStr) else {
      throw NSError(domain: "NitroAutoPrefetcher", code: -1,
                    userInfo: [NSLocalizedDescriptionKey: "Invalid token refresh URL"])
    }

    var request = URLRequest(url: url, timeoutInterval: 10)
    request.httpMethod = (config["method"] as? String) ?? "POST"

    if let reqHeaders = config["headers"] as? [String: String] {
      for (k, v) in reqHeaders { request.setValue(v, forHTTPHeaderField: k) }
    }
    if let body = config["body"] as? String {
      request.httpBody = body.data(using: .utf8)
    }

    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse,
          (200...299).contains(http.statusCode) else {
      throw NSError(domain: "NitroAutoPrefetcher", code: -2,
                    userInfo: [NSLocalizedDescriptionKey: "Token refresh HTTP error"])
    }

    return try parseTokenResponse(data: data, config: config)
  }

  private static func parseTokenResponse(
    data: Data,
    config: [String: Any]
  ) throws -> TokenRefreshResult {
    let responseType = config["responseType"] as? String ?? "json"
    var headers: [String: String] = [:]
    var bodyFields: [String: String] = [:]
    var formFields: [String: String] = [:]

    if responseType == "text" {
      let text = String(data: data, encoding: .utf8) ?? ""
      if let textHeader = config["textHeader"] as? String {
        headers[textHeader] = (config["textTemplate"] as? String)
          .map { $0.replacingOccurrences(of: "{{value}}", with: text) }
          ?? text
      }
      if let bodyTextPath = config["bodyTextPath"] as? String { bodyFields[bodyTextPath] = text }
      if let formDataTextField = config["formDataTextField"] as? String { formFields[formDataTextField] = text }
      return TokenRefreshResult(headers: headers, bodyFields: bodyFields, formFields: formFields)
    }

    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw NSError(domain: "NitroAutoPrefetcher", code: -3,
                    userInfo: [NSLocalizedDescriptionKey: "Token refresh: invalid JSON response"])
    }

    collectMappings(json, config["mappings"] as? [[String: Any]], destKey: "header", into: &headers)
    collectMappings(json, config["bodyMappings"] as? [[String: Any]], destKey: "bodyPath", into: &bodyFields)
    collectMappings(json, config["formDataMappings"] as? [[String: Any]], destKey: "field", into: &formFields)

    if let compositeHeaders = config["compositeHeaders"] as? [[String: Any]] {
      for comp in compositeHeaders {
        guard let header = comp["header"] as? String,
              let template = comp["template"] as? String,
              let paths = comp["paths"] as? [String: String] else { continue }
        var built = template
        for (ph, jsonPath) in paths {
          let val = getNestedField(json, dotPath: jsonPath) ?? ""
          built = built.replacingOccurrences(of: "{{\(ph)}}", with: val)
        }
        headers[header] = built
      }
    }

    return TokenRefreshResult(headers: headers, bodyFields: bodyFields, formFields: formFields)
  }

  // jsonPath -> value (optionally templated), keyed by each mapping's `destKey` field.
  private static func collectMappings(
    _ json: [String: Any],
    _ arr: [[String: Any]]?,
    destKey: String,
    into: inout [String: String]
  ) {
    guard let arr = arr else { return }
    for m in arr {
      guard let jsonPath = m["jsonPath"] as? String,
            let dest = m[destKey] as? String,
            let value = getNestedField(json, dotPath: jsonPath) else { continue }
      into[dest] = (m["valueTemplate"] as? String)
        .map { $0.replacingOccurrences(of: "{{value}}", with: value) }
        ?? value
    }
  }

  private static func getNestedField(_ obj: [String: Any], dotPath: String) -> String? {
    let parts = dotPath.split(separator: ".").map(String.init)
    var current: Any = obj
    for part in parts {
      guard let dict = current as? [String: Any],
            let next = dict[part] else { return nil }
      current = next
    }
    if let s = current as? String { return s }
    return String(describing: current)
  }

  private static func setNestedField(_ root: inout [String: Any], dotPath: String, value: String) {
    let parts = dotPath.split(separator: ".").map(String.init)
    guard !parts.isEmpty else { return }
    if parts.count == 1 {
      root[parts[0]] = value
      return
    }
    var child = (root[parts[0]] as? [String: Any]) ?? [:]
    setNestedField(&child, dotPath: parts.dropFirst().joined(separator: "."), value: value)
    root[parts[0]] = child
  }

  // MARK: - Body / form-data injection

  private static func injectBodyFields(_ rawBody: String?, fields: [String: String]) -> String? {
    if fields.isEmpty { return rawBody }
    // Don't synthesize a JSON body where there wasn't one (e.g. a GET or a
    // form-data request) — only rewrite an existing JSON body.
    guard let rawBody = rawBody, !rawBody.isEmpty else { return rawBody }
    guard let data = rawBody.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      return rawBody
    }
    var root = obj
    for (path, value) in fields {
      setNestedField(&root, dotPath: path, value: value)
    }
    guard let out = try? JSONSerialization.data(withJSONObject: root),
          let str = String(data: out, encoding: .utf8) else { return rawBody }
    return str
  }

  private static func injectFormFields(
    _ parts: [NitroFormDataPart],
    fields: [String: String]
  ) -> [NitroFormDataPart]? {
    if fields.isEmpty { return parts.isEmpty ? nil : parts }
    // Don't synthesize a multipart body where there wasn't one.
    if parts.isEmpty { return nil }
    var result = parts
    for (name, value) in fields {
      if let idx = result.firstIndex(where: { $0.name == name }) {
        let old = result[idx]
        result[idx] = NitroFormDataPart(
          name: old.name, value: value,
          fileUri: nil, fileName: old.fileName, mimeType: old.mimeType
        )
      } else {
        result.append(NitroFormDataPart(name: name, value: value, fileUri: nil, fileName: nil, mimeType: nil))
      }
    }
    return result
  }

  // MARK: - Structured token cache (back-compatible with old flat-header maps)

  private static func serializeCache(_ result: TokenRefreshResult) -> String? {
    let obj: [String: Any] = [
      "headers": result.headers,
      "bodyFields": result.bodyFields,
      "formFields": result.formFields,
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return nil }
    return String(data: data, encoding: .utf8)
  }

  private static func deserializeCache(_ raw: String?) -> TokenRefreshResult {
    guard let raw = raw, !raw.isEmpty,
          let data = raw.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      return .empty
    }
    if obj["headers"] == nil && obj["bodyFields"] == nil && obj["formFields"] == nil {
      // Old flat-header-map cache.
      let headers = (obj as? [String: String]) ?? [:]
      return TokenRefreshResult(headers: headers, bodyFields: [:], formFields: [:])
    }
    return TokenRefreshResult(
      headers: (obj["headers"] as? [String: String]) ?? [:],
      bodyFields: (obj["bodyFields"] as? [String: String]) ?? [:],
      formFields: (obj["formFields"] as? [String: String]) ?? [:]
    )
  }
}

// Expose a C-ABI symbol the ObjC++ file can call
@_cdecl("NitroStartSwift")
public func NitroStartSwift() {
  NitroAutoPrefetcher.prefetchOnStart()
}
