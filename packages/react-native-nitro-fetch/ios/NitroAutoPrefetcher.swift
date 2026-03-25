import Foundation

@objc(NitroAutoPrefetcher)
public final class NitroAutoPrefetcher: NSObject {
  private static var initialized = false
  private static let queueKey = "nitrofetch_autoprefetch_queue"
  private static let suiteName = "nitro_fetch_storage"
  private static let tokenRefreshKey = "nitro_token_refresh_fetch"
  private static let tokenCacheKey = "nitro_token_refresh_fetch_cache"

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
      // Resolve token headers (may require a network call)
      let tokenHeaders: [String: String]
      if let refreshRaw = refreshRaw,
         !refreshRaw.isEmpty,
         let refreshData = refreshRaw.data(using: .utf8),
         let refreshObj = try? JSONSerialization.jsonObject(with: refreshData) as? [String: Any] {
        let onFailure = refreshObj["onFailure"] as? String ?? "useStoredHeaders"
        let refreshURL = refreshObj["url"] as? String ?? "(unknown)"
        print("[NitroFetch][TokenRefresh] Calling refresh endpoint: \(refreshURL)")
        let refreshed = try? await callTokenRefresh(config: refreshObj)
        if let refreshed = refreshed {
          print("[NitroFetch][TokenRefresh] ✅ Success — got \(refreshed.count) header(s)")
          for (k, v) in refreshed { print("[NitroFetch][TokenRefresh]   \(k): \(v)") }
          // Cache fresh token headers for useStoredHeaders fallback on next cold start
          if let cacheData = try? JSONSerialization.data(withJSONObject: refreshed),
             let cacheStr = String(data: cacheData, encoding: .utf8) {
            try? NitroFetchSecureAtRest.setEncrypted(cacheStr, forKey: tokenCacheKey, defaults: userDefaults)
          }
          tokenHeaders = refreshed
        } else {
          print("[NitroFetch][TokenRefresh] ❌ Refresh failed — onFailure: \(onFailure)")
          if onFailure == "skip" {
            print("[NitroFetch][TokenRefresh] Skipping all prefetches")
            return
          }
          var cached: [String: String] = [:]
          if let cacheRaw = NitroFetchSecureAtRest.decryptedString(forKey: tokenCacheKey, defaults: userDefaults),
             !cacheRaw.isEmpty,
             let cacheData = cacheRaw.data(using: .utf8),
             let cacheObj = try? JSONSerialization.jsonObject(with: cacheData) as? [String: String] {
            cached = cacheObj
          }
          print("[NitroFetch][TokenRefresh] Using cached headers (\(cached.count) header(s))")
          tokenHeaders = cached
        }
      } else {
        tokenHeaders = [:]
      }

      // Launch a prefetch task per entry with merged headers
      print("[NitroFetch][TokenRefresh] Injecting token headers into \(arr.count) prefetch URL(s)")
      for item in arr {
        guard let obj = item as? [String: Any] else { continue }
        guard let url = obj["url"] as? String, !url.isEmpty else { continue }
        guard let prefetchKey = obj["prefetchKey"] as? String, !prefetchKey.isEmpty else { continue }
        let headersDict = (obj["headers"] as? [String: Any]) ?? [:]

        // Merge: static headers first, token headers override
        var merged: [String: String] = [:]
        for (k, v) in headersDict { merged[k] = String(describing: v) }
        for (k, v) in tokenHeaders { merged[k] = v }

        var headers: [NitroHeader] = merged.map { NitroHeader(key: $0.key, value: $0.value) }
        headers.append(NitroHeader(key: "prefetchKey", value: prefetchKey))

        print("[NitroFetch][TokenRefresh] Prefetching \(url) with \(merged.count) header(s)")
        for (k, v) in merged { print("[NitroFetch][TokenRefresh]   \(k): \(v)") }

        let req = NitroRequest(
          url: url,
          method: nil,
          headers: headers,
          bodyString: nil,
          bodyBytes: nil,
          bodyFormData: nil,
          timeoutMs: nil,
          followRedirects: true,
          requestId: nil
        )
        Task {
          do { try await NitroFetchClient.prefetchStatic(req) } catch { /* ignore – best effort */ }
        }
      }
    }
  }

  // MARK: - Token refresh

  private static func callTokenRefresh(config: [String: Any]) async throws -> [String: String] {
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
  ) throws -> [String: String] {
    let responseType = config["responseType"] as? String ?? "json"
    var result: [String: String] = [:]

    if responseType == "text" {
      let text = String(data: data, encoding: .utf8) ?? ""
      if let textHeader = config["textHeader"] as? String {
        result[textHeader] = (config["textTemplate"] as? String)
          .map { $0.replacingOccurrences(of: "{{value}}", with: text) }
          ?? text
      }
      return result
    }

    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw NSError(domain: "NitroAutoPrefetcher", code: -3,
                    userInfo: [NSLocalizedDescriptionKey: "Token refresh: invalid JSON response"])
    }

    if let mappings = config["mappings"] as? [[String: Any]] {
      for m in mappings {
        guard let jsonPath = m["jsonPath"] as? String,
              let header = m["header"] as? String else { continue }
        if let value = getNestedField(json, dotPath: jsonPath) {
          result[header] = (m["valueTemplate"] as? String)
            .map { $0.replacingOccurrences(of: "{{value}}", with: value) }
            ?? value
        }
      }
    }

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
        result[header] = built
      }
    }

    return result
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
}

// Expose a C-ABI symbol the ObjC++ file can call
@_cdecl("NitroStartSwift")
public func NitroStartSwift() {
  NitroAutoPrefetcher.prefetchOnStart()
}
