import Foundation

/// Keeps authentication challenges observable by delegate-based networking middleware,
/// and enforces certificate pinning when the app bundles a pinning config.
private final class NitroURLSessionDelegate: NSObject, URLSessionDelegate {
  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    let (disposition, credential) = CertificatePinning.evaluate(challenge) ?? (.performDefaultHandling, nil)
    completionHandler(disposition, credential)
  }
}

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
