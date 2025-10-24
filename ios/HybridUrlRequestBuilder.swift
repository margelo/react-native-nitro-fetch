import Foundation
import NitroModules

class HybridUrlRequestBuilder: HybridUrlRequestBuilderSpec {
  private let url: String
  private let session: URLSession
  private let executor: DispatchQueue

  // Callbacks stored as optionals and set via setter methods
  private var onRedirectReceivedCallback: ((_ info: UrlResponseInfo, _ newLocationUrl: String) -> Void)?
  private var onResponseStartedCallback: ((_ info: UrlResponseInfo) -> Void)?
  private var onReadCompletedCallback: ((_ info: UrlResponseInfo, _ byteBuffer: ArrayBuffer) -> Void)?
  private var onSucceededCallback: ((_ info: UrlResponseInfo) -> Void)?
  private var onFailedCallback: ((_ info: UrlResponseInfo?, _ error: RequestException) -> Void)?
  private var onCanceledCallback: ((_ info: UrlResponseInfo?) -> Void)?

  private var urlRequest: URLRequest
  private var priority: Float = 0.5
  // TEMP: Removed for now - too complex
  // private var uploadProvider: UploadDataProvider?

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

  func onReadCompleted(callback: @escaping (_ info: UrlResponseInfo, _ byteBuffer: ArrayBuffer) -> Void) {
    self.onReadCompletedCallback = callback
  }

  func setHttpMethod(httpMethod: String) throws {
    self.urlRequest.httpMethod = httpMethod
  }

  func addHeader(name: String, value: String) throws {
    self.urlRequest.addValue(value, forHTTPHeaderField: name)
  }

  // TEMP: Commented out - UploadDataProvider has ArrayBuffer
  // func setUploadDataProvider(provider: UploadDataProvider) throws {
  //   self.uploadProvider = provider
  //   // Will be handled in build() using URLSession upload task
  // }

  func setUploadBody(body: Variant_ArrayBuffer_String) throws {
    switch body {
    case .first(let arrayBuffer):
      // Convert ArrayBuffer to Data
      let data = arrayBuffer.toData(copyIfNeeded: true)
      self.urlRequest.httpBody = data

    case .second(let string):
      // Convert String to Data
      self.urlRequest.httpBody = string.data(using: .utf8)
    }
  }

  // TEMP: Removed for now - too complex
  // func setUploadDataProvider(provider: UploadDataProvider) throws {
  //   self.uploadProvider = provider
  // }

  func disableCache() throws {
    self.urlRequest.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
  }

  func setPriority(priority: Double) throws {
    // Map 0-4 priority scale to URLSessionTask priority (0.0-1.0)
    // 0=IDLE, 1=LOWEST, 2=LOW, 3=MEDIUM, 4=HIGHEST
    let normalizedPriority = Float(priority) / 4.0
    self.priority = normalizedPriority
  }

  func allowDirectExecutor() throws {
    // No-op on iOS - URLSession manages its own threading
  }

  func build() throws -> any HybridUrlRequestSpec {
    // Create a custom URLSession delegate to handle callbacks
    // Pass individual callbacks to avoid Swift compiler bug
    let delegate = URLSessionDelegateAdapter(
      onRedirectReceived: onRedirectReceivedCallback,
      onResponseStarted: onResponseStartedCallback,
      onReadCompleted: onReadCompletedCallback,
      onSucceeded: onSucceededCallback,
      onFailed: onFailedCallback,
      onCanceled: onCanceledCallback,
      executor: executor,
      hybridRequest: nil
      // uploadProvider: uploadProvider
    )

    // Create a dedicated URLSession for this request with the custom delegate
    let config = URLSessionConfiguration.default
    config.urlCache = session.configuration.urlCache
    config.requestCachePolicy = urlRequest.cachePolicy

    let delegateSession = URLSession(
      configuration: config,
      delegate: delegate,
      delegateQueue: nil
    )

    // Create the task
    let task: URLSessionDataTask = delegateSession.dataTask(with: urlRequest)

    task.priority = priority
    delegate.task = task

    let request = HybridUrlRequest(task: task, delegate: delegate)
    delegate.hybridRequest = request

    return request
  }
}

// MARK: - URLSession Delegate Adapter

  private class URLSessionDelegateAdapter: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    // Optional callbacks - only called if set
    let onRedirectReceived: ((_ info: UrlResponseInfo, _ newLocationUrl: String) -> Void)?
    let onResponseStarted: ((_ info: UrlResponseInfo) -> Void)?
    let onReadCompleted: ((_ info: UrlResponseInfo, _ byteBuffer: ArrayBuffer) -> Void)?
    let onSucceeded: ((_ info: UrlResponseInfo) -> Void)?
    let onFailed: ((_ info: UrlResponseInfo?, _ error: RequestException) -> Void)?
    let onCanceled: ((_ info: UrlResponseInfo?) -> Void)?

  let executor: DispatchQueue
  // TEMP: Removed for now - too complex
  // var uploadProvider: UploadDataProvider?
  weak var task: URLSessionDataTask?
  weak var hybridRequest: HybridUrlRequest?

  private var receivedData = Data()
  private var response: HTTPURLResponse?
  private var redirectCount = 0

    init(
      onRedirectReceived: ((_ info: UrlResponseInfo, _ newLocationUrl: String) -> Void)?,
      onResponseStarted: ((_ info: UrlResponseInfo) -> Void)?,
      onReadCompleted: ((_ info: UrlResponseInfo, _ byteBuffer: ArrayBuffer) -> Void)?,
      onSucceeded: ((_ info: UrlResponseInfo) -> Void)?,
      onFailed: ((_ info: UrlResponseInfo?, _ error: RequestException) -> Void)?,
      onCanceled: ((_ info: UrlResponseInfo?) -> Void)?,
      executor: DispatchQueue,
      hybridRequest: HybridUrlRequest?
      // uploadProvider: UploadDataProvider?
    ) {
      self.onRedirectReceived = onRedirectReceived
      self.onResponseStarted = onResponseStarted
      self.onReadCompleted = onReadCompleted
      self.onSucceeded = onSucceeded
      self.onFailed = onFailed
      self.onCanceled = onCanceled
      self.executor = executor
      self.hybridRequest = hybridRequest
      // self.uploadProvider = uploadProvider
      super.init()
    }

  // MARK: - URLSessionTaskDelegate
  //
  // IMPORTANT: All callbacks use executor.sync (not .async) to guarantee ordering:
  // 1. onRedirectReceived (if redirects occur)
  // 2. onResponseStarted (once)
  // 3. onReadCompleted (multiple times, in order)
  // 4. onSucceeded/onFailed/onCanceled (once)
  //
  // This prevents race conditions where onSucceeded could fire before the final onReadCompleted.

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    // Use sync to ensure ordering
    executor.sync { [weak self] in
      guard let self = self else { return }

      // Call callback if set
      if let callback = self.onRedirectReceived {
        let info = response.toNitro()
        let newUrl = request.url?.absoluteString ?? ""
        callback(info, newUrl)
      }
    }

    // Auto-follow redirects (matching Android behavior)
    completionHandler(request)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    needNewBodyStream completionHandler: @escaping (InputStream?) -> Void
  ) {
    // Handle upload provider rewind
    // TEMP: Removed UploadDataProvider for now
    completionHandler(nil)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didCompleteWithError error: Error?
  ) {
    // Use sync to ensure this runs after all didReceive callbacks
    executor.sync { [weak self] in
      guard let self = self else { return }

      self.hybridRequest?.markDone()

      if let error = error {
        let nsError = error as NSError
        if nsError.code == NSURLErrorCancelled {
          if let callback = self.onCanceled {
            let nitroInfo = self.response?.toNitro()
            callback(nitroInfo)
          }
        } else {
          if let callback = self.onFailed {
            let nitroError = error.toNitro()
            let nitroInfo = self.response?.toNitro()
            callback(nitroInfo, nitroError)
          }
        }
      } else if let response = self.response {
        if let callback = self.onSucceeded {
          let info = response.toNitro()
          callback(info)
        }
      }
    }
  }

  // MARK: - URLSessionDataDelegate

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

    // Use sync to ensure this runs before any didReceive data callbacks
    executor.sync { [weak self] in
      guard let self = self else { return }

      // Call callback if set
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
    receivedData.append(data)

    // If onReadCompleted callback is set, notify with the chunk
    if let callback = self.onReadCompleted {
      // Use sync to ensure ordering - data callbacks fire in order before completion
      executor.sync { [weak self] in
        guard let self = self, let response = self.response else { return }

        // Copy data into ArrayBuffer
        let arrayBuffer: ArrayBuffer
        do {
          arrayBuffer = try ArrayBuffer.copy(data: data)
        } catch {
          // If we can't create ArrayBuffer, call onFailed if set
          if let failedCallback = self.onFailed {
            let nitroError = error.toNitro()
            let nitroInfo = response.toNitro()
            failedCallback(nitroInfo, nitroError)
          }
          return
        }

        let info = response.toNitro()
        callback(info, arrayBuffer)
      }
    }
  }
}
