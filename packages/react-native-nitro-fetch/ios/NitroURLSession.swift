import Foundation

/// Keeps authentication challenges observable by delegate-based networking middleware.
private final class NitroURLSessionDelegate: NSObject, URLSessionDelegate {}

enum NitroURLCache {
  static let shared = URLCache(
    memoryCapacity: 32 * 1024 * 1024,
    diskCapacity: 100 * 1024 * 1024,
    diskPath: "nitrofetch_urlcache"
  )
}

enum NitroURLSession {
  static let shared = make(configuration: .default)

  static func make(configuration: URLSessionConfiguration) -> URLSession {
    return URLSession(
      configuration: configuration,
      delegate: NitroURLSessionDelegate(),
      delegateQueue: nil
    )
  }
}
