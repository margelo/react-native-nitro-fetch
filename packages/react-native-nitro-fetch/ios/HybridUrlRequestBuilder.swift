import Foundation
import NitroModules

class HybridUrlRequestBuilder: HybridUrlRequestBuilderSpec {
  private let url: String
  private let session: URLSession
  private let executor: DispatchQueue

  // Callbacks stored as optionals and set via setter methods
  private var onRedirectReceivedCallback: ((_ info: UrlResponseInfo, _ newLocationUrl: String) -> Void)?
  private var onResponseStartedCallback: ((_ info: UrlResponseInfo) -> Void)?
  private var onReadCompletedCallback: ((_ info: UrlResponseInfo, _ byteBuffer: ArrayBuffer, _ bytesRead: Double) -> Void)?
  private var onSucceededCallback: ((_ info: UrlResponseInfo) -> Void)?
  private var onFailedCallback: ((_ info: UrlResponseInfo?, _ error: RequestException) -> Void)?
  private var onCanceledCallback: ((_ info: UrlResponseInfo?) -> Void)?

  private var urlRequest: URLRequest
  private var priority: Float = 0.5
  private let devToolsRequestId: String = UUID().uuidString

  init(
    url: String,
    session: URLSession,
    executor: DispatchQueue
  ) {
    self.url = url
    self.session = session
    self.executor = executor

    guard let urlObj = URL(string: url) else {
      fatalError("Invalid URL: \(url)")
    }
    self.urlRequest = URLRequest(url: urlObj)
  }

  // MARK: - Callback Setters
  // Each setter takes only 1 callback to avoid Swift compiler bug (crashes with 4+ callbacks)

  func onSucceeded(callback: @escaping (_ info: UrlResponseInfo) -> Void) {
    self.onSucceededCallback = callback
  }

  func onFailed(callback: @escaping (_ info: UrlResponseInfo?, _ error: RequestException) -> Void) {
    self.onFailedCallback = callback
  }

  func onCanceled(callback: @escaping (_ info: UrlResponseInfo?) -> Void) {
    self.onCanceledCallback = callback
  }

  func onRedirectReceived(callback: @escaping (_ info: UrlResponseInfo, _ newLocationUrl: String) -> Void) {
    self.onRedirectReceivedCallback = callback
  }

  func onResponseStarted(callback: @escaping (_ info: UrlResponseInfo) -> Void) {
    self.onResponseStartedCallback = callback
  }

  func onReadCompleted(callback: @escaping (_ info: UrlResponseInfo, _ byteBuffer: ArrayBuffer, _ bytesRead: Double) -> Void) {
    self.onReadCompletedCallback = callback
  }

  func setHttpMethod(httpMethod: String) throws {
    self.urlRequest.httpMethod = httpMethod
  }

  func addHeader(name: String, value: String) throws {
    self.urlRequest.addValue(value, forHTTPHeaderField: name)
  }

  func setUploadBody(body: Variant_ArrayBuffer_String) throws {
    switch body {
    case .first(let arrayBuffer):
      self.urlRequest.httpBody = arrayBuffer.toData(copyIfNeeded: true)
    case .second(let string):
      self.urlRequest.httpBody = string.data(using: .utf8)
    }
  }

  func disableCache() throws {
    self.urlRequest.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
  }

  func build() throws -> any HybridUrlRequestSpec {
    let delegate = URLSessionDelegateAdapter(
      onRedirectReceived: onRedirectReceivedCallback,
      onResponseStarted: onResponseStartedCallback,
      onReadCompleted: onReadCompletedCallback,
      onSucceeded: onSucceededCallback,
      onFailed: onFailedCallback,
      onCanceled: onCanceledCallback,
      executor: executor,
      hybridRequest: nil,
      devToolsRequestId: devToolsRequestId
    )

    let config = URLSessionConfiguration.default
    config.urlCache = session.configuration.urlCache
    config.requestCachePolicy = urlRequest.cachePolicy

    let delegateSession = URLSession(
      configuration: config,
      delegate: delegate,
      delegateQueue: nil
    )

    let task: URLSessionDataTask = delegateSession.dataTask(with: urlRequest)

    task.priority = priority
    delegate.task = task

    if NitroDevToolsReporter.isDebuggingEnabled() {
      NitroDevToolsReporter.reportRequestStart(withRequest: devToolsRequestId, request: urlRequest)
    }

    let request = HybridUrlRequest(task: task, delegate: delegate)
    delegate.hybridRequest = request

    return request
  }
}

// MARK: - URLSession Delegate Adapter

private class URLSessionDelegateAdapter: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
  let onRedirectReceived: ((_ info: UrlResponseInfo, _ newLocationUrl: String) -> Void)?
  let onResponseStarted: ((_ info: UrlResponseInfo) -> Void)?
  let onReadCompleted: ((_ info: UrlResponseInfo, _ byteBuffer: ArrayBuffer, _ bytesRead: Double) -> Void)?
  let onSucceeded: ((_ info: UrlResponseInfo) -> Void)?
  let onFailed: ((_ info: UrlResponseInfo?, _ error: RequestException) -> Void)?
  let onCanceled: ((_ info: UrlResponseInfo?) -> Void)?

  let executor: DispatchQueue
  weak var task: URLSessionDataTask?
  weak var hybridRequest: HybridUrlRequest?

  private var response: HTTPURLResponse?
  private let devToolsRequestId: String
  private var devToolsBytes: Int = 0
  private var devToolsTextual: Bool = false

  init(
    onRedirectReceived: ((_ info: UrlResponseInfo, _ newLocationUrl: String) -> Void)?,
    onResponseStarted: ((_ info: UrlResponseInfo) -> Void)?,
    onReadCompleted: ((_ info: UrlResponseInfo, _ byteBuffer: ArrayBuffer, _ bytesRead: Double) -> Void)?,
    onSucceeded: ((_ info: UrlResponseInfo) -> Void)?,
    onFailed: ((_ info: UrlResponseInfo?, _ error: RequestException) -> Void)?,
    onCanceled: ((_ info: UrlResponseInfo?) -> Void)?,
    executor: DispatchQueue,
    hybridRequest: HybridUrlRequest?,
    devToolsRequestId: String
  ) {
    self.onRedirectReceived = onRedirectReceived
    self.onResponseStarted = onResponseStarted
    self.onReadCompleted = onReadCompleted
    self.onSucceeded = onSucceeded
    self.onFailed = onFailed
    self.onCanceled = onCanceled
    self.executor = executor
    self.hybridRequest = hybridRequest
    self.devToolsRequestId = devToolsRequestId
    super.init()
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    executor.sync { [weak self] in
      guard let self = self else { return }
      if let callback = self.onRedirectReceived {
        let info = response.toNitro()
        let newUrl = request.url?.absoluteString ?? ""
        callback(info, newUrl)
      }
    }
    completionHandler(request)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didCompleteWithError error: Error?
  ) {
    executor.sync { [weak self] in
      guard let self = self else { return }
      self.hybridRequest?.markDone()

      if let error = error {
        let nsError = error as NSError
        if nsError.code == NSURLErrorCancelled {
          if NitroDevToolsReporter.isDebuggingEnabled() {
            NitroDevToolsReporter.reportRequestFailed(self.devToolsRequestId, cancelled: true)
          }
          if let callback = self.onCanceled {
            let nitroInfo = self.response?.toNitro()
            callback(nitroInfo)
          }
        } else {
          if NitroDevToolsReporter.isDebuggingEnabled() {
            NitroDevToolsReporter.reportRequestFailed(self.devToolsRequestId, cancelled: false)
          }
          if let callback = self.onFailed {
            let nitroError = error.toNitro()
            let nitroInfo = self.response?.toNitro()
            callback(nitroInfo, nitroError)
          }
        }
      } else if let response = self.response {
        if NitroDevToolsReporter.isDebuggingEnabled() {
          NitroDevToolsReporter.reportResponseEnd(self.devToolsRequestId, encodedDataLength: self.devToolsBytes)
        }
        if let callback = self.onSucceeded {
          let info = response.toNitro()
          callback(info)
        }
      }
    }
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    guard let httpResponse = response as? HTTPURLResponse else {
      completionHandler(.cancel)
      return
    }

    self.response = httpResponse

    executor.sync { [weak self] in
      guard let self = self else { return }
      if NitroDevToolsReporter.isDebuggingEnabled() {
        var headerDict: [String: String] = [:]
        httpResponse.allHeaderFields.forEach { k, v in
          if let key = k as? String { headerDict[key] = String(describing: v) }
        }
        NitroDevToolsReporter.reportResponseStart(
          self.devToolsRequestId,
          url: httpResponse.url?.absoluteString ?? "",
          statusCode: httpResponse.statusCode,
          headers: headerDict
        )
        let ct = headerDict["Content-Type"] ?? headerDict["content-type"]
        self.devToolsTextual = NitroDevToolsReporter.isTextualContentType(ct)
      }
      if let callback = self.onResponseStarted {
        let info = httpResponse.toNitro()
        callback(info)
      }
    }

    completionHandler(.allow)
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive data: Data
  ) {
    if let callback = self.onReadCompleted {
      executor.sync { [weak self] in
        guard let self = self, let response = self.response else { return }

        if NitroDevToolsReporter.isDebuggingEnabled() {
          self.devToolsBytes += data.count
          NitroDevToolsReporter.reportDataReceived(self.devToolsRequestId, length: data.count)
          if self.devToolsTextual, let text = String(data: data, encoding: .utf8) {
            NitroDevToolsReporter.storeResponseBodyIncremental(self.devToolsRequestId, text: text)
          }
        }

        let arrayBuffer: ArrayBuffer
        do {
          arrayBuffer = try ArrayBuffer.copy(data: data)
        } catch {
          if let failedCallback = self.onFailed {
            let nitroError = error.toNitro()
            let nitroInfo = response.toNitro()
            failedCallback(nitroInfo, nitroError)
          }
          return
        }

        let info = response.toNitro()
        let bytesRead = Double(data.count)
        callback(info, arrayBuffer, bytesRead)
      }
    }
  }
}
