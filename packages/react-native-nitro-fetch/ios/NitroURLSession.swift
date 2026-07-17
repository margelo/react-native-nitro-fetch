import Foundation

/// Keeps authentication challenges observable by delegate-based networking middleware.
private final class NitroURLSessionDelegate: NSObject, URLSessionDelegate {}

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
