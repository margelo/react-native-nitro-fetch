import Foundation

/// Keeps authentication challenges observable by delegate-based networking middleware.
private final class NitroURLSessionDelegate: NSObject, URLSessionDelegate {}

/// Used instead of `NitroURLSessionDelegate` only when the app bundles a pinning config, so apps
/// without one never get a server-trust callback on the session's delegate queue.
private final class NitroPinningURLSessionDelegate: NSObject, URLSessionDelegate {
  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    if !CertificatePinning.handle(challenge, completion: completionHandler) {
      completionHandler(.performDefaultHandling, nil)
    }
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
    let delegate: URLSessionDelegate = CertificatePinning.isConfigured
      ? NitroPinningURLSessionDelegate()
      : NitroURLSessionDelegate()
    return URLSession(
      configuration: configuration,
      delegate: delegate,
      delegateQueue: nil
    )
  }
}
