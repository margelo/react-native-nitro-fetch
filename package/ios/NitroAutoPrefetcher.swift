import Foundation

@objc(NitroAutoPrefetcher)
public final class NitroAutoPrefetcher: NSObject {
  private static var initialized = false
  private static let queueKey = "nitrofetch_autoprefetch_queue"

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
      var headers: [NitroHeader] = headersDict.map { (k, v) in NitroHeader(key: String(describing: k), value: String(describing: v)) }
      headers.append(NitroHeader(key: "prefetchKey", value: prefetchKey))
      let req = NitroRequest(url: url,
                             method: nil,
                             headers: headers,
                             bodyString: nil,
                             bodyBytes: nil,
                             timeoutMs: nil,
                             followRedirects: true)
      Task {
        do { try await NitroFetchClient.prefetchStatic(req) } catch { /* ignore – best effort */ }
      }
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
