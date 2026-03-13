import Foundation

@objc(NitroAutoPrefetcher)
public final class NitroAutoPrefetcher: NSObject {
  private static var initialized = false
  private static let queueKey = "nitrofetch_autoprefetch_queue"
  private static let defaultMaxAge: Int64 = 5_000 // 5 seconds

  @objc
  public static func prefetchOnStart() {
    if initialized { return }
    initialized = true

    guard let raw = readMMKVString(forKey: queueKey), !raw.isEmpty else { return }
    guard let data = raw.data(using: .utf8) else { return }
    guard let arr = try? JSONSerialization.jsonObject(with: data, options: []) as? [Any] else { return }

    for item in arr {
      guard let obj = item as? [String: Any] else { continue }
      guard let url = obj["url"] as? String, !url.isEmpty else { continue }
      guard let prefetchKey = obj["prefetchKey"] as? String, !prefetchKey.isEmpty else { continue }

      let headersDict = (obj["headers"] as? [String: Any]) ?? [:]
      let maxAge = (obj["maxAge"] as? Int64) ?? defaultMaxAge

      // If already pending or fresh, skip
      if FetchCache.getPending(prefetchKey) {
        continue
      }

      if FetchCache.getResultIfFresh(prefetchKey, maxAgeMs: maxAge) != nil {
        continue
      }

      // Build headers map
      var headers: [String: String] = [:]
      for (key, value) in headersDict {
        headers[key] = String(describing: value)
      }
      headers["prefetchKey"] = prefetchKey

      // Start prefetch request using SimpleFetch
      startPrefetchRequest(url: url, headers: headers, prefetchKey: prefetchKey, maxAgeMs: maxAge)
    }
  }

  private static func startPrefetchRequest(
    url: String,
    headers: [String: String],
    prefetchKey: String,
    maxAgeMs: Int64
  ) {
    // Use SimpleFetch.prefetch which handles cache management
    SimpleFetch.prefetch(
      url: url,
      method: "GET",
      headers: headers,
      body: nil,
      prefetchKey: prefetchKey,
      maxAgeMs: maxAgeMs
    ) { _ in
      // Best effort - ignore errors
    }
  }

  // MARK: - MMKV dynamic access (optional)

  private static func readMMKVString(forKey key: String) -> String? {
    guard let mmkvClass = NSClassFromString("MMKV") as? NSObject.Type else { return nil }

    // Try to initialize if needed (ignore failures)
    let initSelectors = [
      NSSelectorFromString("initializeMMKV:"),
      NSSelectorFromString("initialize:")
    ]
    for sel in initSelectors where mmkvClass.responds(to: sel) {
      _ = mmkvClass.perform(sel, with: nil)
      break
    }

    guard let mmkvObjUnretained = mmkvClass.perform(NSSelectorFromString("defaultMMKV"))?.takeUnretainedValue() else { return nil }
    let mmkv = mmkvObjUnretained as AnyObject

    // Try common selectors
    let candidates = [
      NSSelectorFromString("decodeStringForKey:"),
      NSSelectorFromString("stringForKey:"),
      NSSelectorFromString("getStringForKey:"),
    ]
    for sel in candidates where mmkv.responds(to: sel) {
      if let val = mmkv.perform(sel, with: key)?.takeUnretainedValue() as? String {
        return val
      }
    }

    // Some APIs have (forKey: defaultValue:) signatures
    let twoArgCandidates = [
      NSSelectorFromString("decodeStringForKey:defaultValue:"),
      NSSelectorFromString("stringForKey:defaultValue:"),
      NSSelectorFromString("getStringForKey:defaultValue:"),
    ]
    for sel in twoArgCandidates where mmkv.responds(to: sel) {
      // NSInvocation is cumbersome in Swift; best-effort fallthrough without it
      // Prefer single-arg variants above.
      break
    }
    return nil
  }
}

// Expose a C-ABI symbol the ObjC++ file can call
@_cdecl("NitroStartSwift")
public func NitroStartSwift() {
  NitroAutoPrefetcher.prefetchOnStart()
}
