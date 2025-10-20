import Foundation
import NitroModules

/**
 * URL Request implementation for iOS.
 */
final class NitroUrlRequest: HybridUrlRequestSpec {

  private let session: URLSession
  private var request: URLRequest
  private let callback: UrlRequestCallback
  private let priority: Float
  private let uploadProvider: UploadDataProvider?

  private var task: URLSessionDataTask?
  private var responseInfo: UrlResponseInfo?
  private var receivedData = Data()
  private var isDoneFlag = false
  private var delegate: URLSessionDelegate?

  init(
    session: URLSession,
    request: URLRequest,
    callback: UrlRequestCallback,
    priority: Float,
    uploadProvider: UploadDataProvider?
  ) {
    self.session = session
    self.request = request
    self.callback = callback
    self.priority = priority
    self.uploadProvider = uploadProvider
    super.init()
  }

  func start() throws {
    // Create delegate object
    let sessionDelegate = URLSessionDelegate(
      onResponse: { [weak self] response in
        guard let self = self else { return }
        self.responseInfo = self.convertToUrlResponseInfo(response, url: self.request.url?.absoluteString ?? "")
        if let info = self.responseInfo {
          self.callback.onResponseStarted(info)
        }
      },
      onData: { [weak self] data in
        self?.receivedData.append(data)
      },
      onComplete: { [weak self] error in
        guard let self = self else { return }
        if let error = error {
          let nsError = error as NSError
          let domain = self.errorDomainValue(from: nsError.domain)
          let underlyingError = (nsError.userInfo[NSUnderlyingErrorKey] as? NSError)?.localizedDescription

          let nitroError = NitroRequestException.network(
            message: nsError.localizedDescription,
            code: Double(nsError.code),
            domain: domain,
            localizedDescription: nsError.localizedDescription,
            underlyingError: underlyingError
          )
          self.callback.onFailed(self.responseInfo, nitroError)
        } else if let info = self.responseInfo {
          self.callback.onSucceeded(info)
        }
        self.isDoneFlag = true
      }
    )

    self.delegate = sessionDelegate
    let delegateSession = URLSession(configuration: session.configuration, delegate: sessionDelegate, delegateQueue: nil)

    let task = delegateSession.dataTask(with: request)
    task.priority = priority
    self.task = task
    task.resume()
  }

  func followRedirect() throws {
    // URLSession handles redirects automatically
    // This is called to continue after onRedirectReceived
  }

  func read(buffer: ArrayBuffer) throws {
    // ArrayBuffer is an opaque holder, we need to write data to it directly
    // For now, store the buffer and deliver data when available
    if !receivedData.isEmpty {
      deliverData(to: buffer)
    }
  }

  func cancel() throws {
    task?.cancel()
    isDoneFlag = true
  }

  func isDone() throws -> Bool {
    return isDoneFlag
  }

  // MARK: - Helper Methods

  private func errorDomainValue(from domain: String) -> Double {
    if domain == NSURLErrorDomain {
      return 0
    } else if domain == NSPOSIXErrorDomain {
      return 1
    } else if domain == (kCFErrorDomainCFNetwork as String) {
      return 2
    } else if domain == (kCFErrorDomainOSStatus as String) {
      return 3
    } else {
      return 0
    }
  }

  private func deliverData(to buffer: ArrayBuffer) {
    guard !receivedData.isEmpty else { return }

    // Create a new ArrayBuffer from the received data
    do {
      let deliveredBuffer = try ArrayBuffer.copy(data: receivedData)
      receivedData.removeAll()

      if let info = responseInfo {
        callback.onReadCompleted(info, deliveredBuffer)
      }
    } catch {
      // If we can't create the buffer, reject the request
      let nitroError = NitroRequestException.other(
        message: "Failed to create ArrayBuffer: \(error.localizedDescription)",
        code: -1
      )
      callback.onFailed(responseInfo, nitroError)
      isDoneFlag = true
    }
  }

  private func convertToUrlResponseInfo(_ response: HTTPURLResponse, url: String) -> UrlResponseInfo {
    var headersDict: [String: String] = [:]
    var headersList: [HttpHeader] = []

    for (key, value) in response.allHeaderFields {
      if let keyStr = key as? String {
        let valueStr = String(describing: value)
        headersDict[keyStr] = valueStr
        headersList.append(HttpHeader(key: keyStr, value: valueStr))
      }
    }

    return UrlResponseInfo(
      url: response.url?.absoluteString ?? url,
      httpStatusCode: Double(response.statusCode),
      httpStatusText: HTTPURLResponse.localizedString(forStatusCode: response.statusCode),
      allHeaders: headersDict,
      allHeadersAsList: headersList,
      urlChain: [url], // URLSession doesn't track full redirect chain
      negotiatedProtocol: response.value(forHTTPHeaderField: "Alt-Svc") ?? "http/1.1",
      proxyServer: "",
      receivedByteCount: Double(receivedData.count),
      wasCached: false // We could check URLCache but keeping it simple
    )
  }
}

// MARK: - URLSessionDelegate Helper

private class URLSessionDelegate: NSObject, URLSessionDataDelegate {
  private let onResponse: (HTTPURLResponse) -> Void
  private let onData: (Data) -> Void
  private let onComplete: (Error?) -> Void

  init(
    onResponse: @escaping (HTTPURLResponse) -> Void,
    onData: @escaping (Data) -> Void,
    onComplete: @escaping (Error?) -> Void
  ) {
    self.onResponse = onResponse
    self.onData = onData
    self.onComplete = onComplete
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
    onResponse(httpResponse)
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    onData(data)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    onComplete(error)
    session.finishTasksAndInvalidate()
  }
}
