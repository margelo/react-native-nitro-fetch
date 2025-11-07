import Foundation

@objc(NitroAutoPrefetcher)
public final class NitroAutoPrefetcher: NSObject {
  private static var initialized = false
  private static let queueKey = "nitrofetch_autoprefetch_queue"
  private static let suiteName = "nitro_fetch_storage"

  @objc
  public static func prefetchOnStart() {
    if initialized { return }
    initialized = true
    
    // Read from UserDefaults
    let userDefaults = UserDefaults(suiteName: suiteName) ?? UserDefaults.standard
    guard let raw = userDefaults.string(forKey: queueKey), !raw.isEmpty else { return }
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
}

// Expose a C-ABI symbol the ObjC++ file can call
@_cdecl("NitroStartSwift")
public func NitroStartSwift() {
  NitroAutoPrefetcher.prefetchOnStart()
}
