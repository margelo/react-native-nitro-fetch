import Foundation
import NitroModules

/// Loads a whole body like `URLSession.data(for:delegate:)`, for a request that also wants to
/// hear about the response while it loads. `data(for:delegate:)` never calls a delegate's
/// `didReceive response` or `didReceive data`, so this runs a data task and collects the body.
/// - `onResponseStarted` gets the response before the body, unless the whole body arrives with it.
/// - `onData` gets a `text/event-stream` body as it arrives, which is then not collected.
/// - `onProgress` gets the bytes received so far, at most every 50 ms and once at the end.
final class NitroBufferedTaskDelegate: NSObject, URLSessionDataDelegate {
  private static let progressIntervalNs: UInt64 = 50_000_000

  private let followRedirects: Bool
  private let onResponseStarted: ((UrlResponseInfo) -> Void)?
  private let onData: ((ArrayBuffer) -> Void)?
  private let onProgress: ((Double, Double) -> Void)?

  // Used only on the session's delegate queue.
  private var response: HTTPURLResponse?
  private var body = Data()
  private var streaming = false
  private var reportedResponse = false
  private var expectedLength: Int64 = -1
  private var lengthIsExact = false
  private var received: Int64 = 0
  private var reportedProgress: Int64 = -1
  private var lastProgressNs: UInt64 = 0

  // A task cancelled before it starts can complete before the continuation is set,
  // so the two meet under this lock.
  private let lock = NSLock()
  private var continuation: CheckedContinuation<(Data, URLResponse), Error>?
  private var result: Result<(Data, URLResponse), Error>?

  private init(
    followRedirects: Bool,
    onResponseStarted: ((UrlResponseInfo) -> Void)?,
    onData: ((ArrayBuffer) -> Void)?,
    onProgress: ((Double, Double) -> Void)?
  ) {
    self.followRedirects = followRedirects
    self.onResponseStarted = onResponseStarted
    self.onData = onData
    self.onProgress = onProgress
  }

  static func data(
    for request: URLRequest,
    session: URLSession,
    followRedirects: Bool,
    priority: NitroRequestPriority?,
    onResponseStarted: ((UrlResponseInfo) -> Void)?,
    onData: ((ArrayBuffer) -> Void)?,
    onProgress: ((Double, Double) -> Void)?
  ) async throws -> (Data, URLResponse) {
    let delegate = NitroBufferedTaskDelegate(
      followRedirects: followRedirects,
      onResponseStarted: onResponseStarted,
      onData: onData,
      onProgress: onProgress
    )
    let task = session.dataTask(with: request)
    task.delegate = delegate
    if let priority = priority { task.priority = priority.taskPriority }
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        delegate.wait(continuation)
        task.resume()
      }
    } onCancel: {
      task.cancel()
    }
  }

  private func wait(_ continuation: CheckedContinuation<(Data, URLResponse), Error>) {
    lock.lock()
    guard let result = result else {
      self.continuation = continuation
      lock.unlock()
      return
    }
    lock.unlock()
    continuation.resume(with: result)
  }

  private func finish(_ result: Result<(Data, URLResponse), Error>) {
    lock.lock()
    guard let continuation = continuation else {
      if self.result == nil { self.result = result }
      lock.unlock()
      return
    }
    self.continuation = nil
    lock.unlock()
    continuation.resume(with: result)
  }

  private func reportResponse() {
    guard !reportedResponse, let response = response, let onResponseStarted = onResponseStarted else { return }
    reportedResponse = true
    onResponseStarted(response.toNitro())
  }

  private func reportProgress(final: Bool) {
    guard let onProgress = onProgress, received != reportedProgress else { return }
    let now = DispatchTime.now().uptimeNanoseconds
    if !final && now - lastProgressNs < NitroBufferedTaskDelegate.progressIntervalNs { return }
    lastProgressNs = now
    reportedProgress = received
    onProgress(Double(received), Double(expectedLength))
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    if let http = response as? HTTPURLResponse {
      self.response = http
      expectedLength = http.expectedContentLength
      let encoding = http.value(forHTTPHeaderField: "Content-Encoding")?.lowercased() ?? "identity"
      lengthIsExact = expectedLength >= 0 && encoding == "identity"
      if onData != nil && http.isEventStream {
        streaming = true
        reportResponse()
      } else if lengthIsExact && expectedLength > 0 {
        body.reserveCapacity(Int(min(expectedLength, 1 << 20)))
      }
    }
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    received += Int64(data.count)
    if streaming, let onData = onData {
      do {
        onData(try ArrayBuffer.copy(data: data))
      } catch {
        finish(.failure(error))
        dataTask.cancel()
      }
      return
    }
    body.append(data)
    if !(lengthIsExact && received >= expectedLength) {
      reportResponse()
    }
    reportProgress(final: false)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping @Sendable (URLRequest?) -> Void
  ) {
    completionHandler(followRedirects ? request : nil)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let error = error {
      finish(.failure(error))
    } else if let response = task.response {
      if !streaming { reportProgress(final: true) }
      finish(.success((body, response)))
    } else {
      finish(.failure(URLError(.badServerResponse)))
    }
  }
}
