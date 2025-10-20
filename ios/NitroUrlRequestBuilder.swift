import Foundation
import NitroModules

/**
 * URL Request Builder implementation for iOS.
 */
final class NitroUrlRequestBuilder: HybridUrlRequestBuilderSpec {

  private let session: URLSession
  private let url: String
  private let callback: UrlRequestCallback

  private var httpMethod: String = "GET"
  private var headers: [String: String] = [:]
  private var uploadBody: Data?
  private var uploadProvider: UploadDataProvider?
  private var cacheDisabled: Bool = false
  private var priority: Float = URLSessionTask.defaultPriority

  init(session: URLSession, url: String, callback: UrlRequestCallback) {
    self.session = session
    self.url = url
    self.callback = callback
    super.init()
  }

  func setHttpMethod(httpMethod: String) throws {
    self.httpMethod = httpMethod
  }

  func addHeader(name: String, value: String) throws {
    self.headers[name] = value
  }

  func setUploadDataProvider(provider: UploadDataProvider) throws {
    self.uploadProvider = provider
  }

  func setUploadBody(body: Variant_ArrayBuffer_String) throws {
    switch body {
    case .first(let arrayBuffer):
      // Convert ArrayBuffer to Data
      self.uploadBody = arrayBuffer.toData(copyIfNeeded: true)
    case .second(let string):
      self.uploadBody = string.data(using: .utf8)
    }
  }

  func disableCache() throws {
    self.cacheDisabled = true
  }

  func setPriority(priority: Double) throws {
    // Map Cronet priorities to URLSessionTask priorities (Float 0.0-1.0)
    // 0=IDLE, 1=LOWEST, 2=LOW, 3=MEDIUM, 4=HIGHEST
    switch Int(priority) {
    case 0, 1:
      self.priority = URLSessionTask.lowPriority
    case 2:
      self.priority = URLSessionTask.defaultPriority
    case 4:
      self.priority = URLSessionTask.highPriority
    default:
      self.priority = URLSessionTask.defaultPriority
    }
  }

  func allowDirectExecutor() throws {
    // iOS doesn't have direct executor concept like Cronet
    // This is a no-op but maintains API compatibility
  }

  func build() throws -> (any HybridUrlRequestSpec) {
    guard let url = URL(string: self.url) else {
      throw NSError(
        domain: "NitroUrlRequestBuilder",
        code: -1,
        userInfo: [NSLocalizedDescriptionKey: "Invalid URL: \(self.url)"]
      )
    }

    var request = URLRequest(url: url)
    request.httpMethod = httpMethod

    if cacheDisabled {
      request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    }

    for (key, value) in headers {
      request.addValue(value, forHTTPHeaderField: key)
    }

    // Handle upload body
    if let uploadBody = uploadBody {
      request.httpBody = uploadBody
    } else if let provider = uploadProvider {
      // For streaming uploads, we'll need to handle this in NitroUrlRequest
      // Store the provider for later use
    }

    return NitroUrlRequest(
      session: session,
      request: request,
      callback: callback,
      priority: priority,
      uploadProvider: uploadProvider
    )
  }
}
