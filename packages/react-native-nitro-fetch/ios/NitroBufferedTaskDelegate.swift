import Foundation
import NitroModules

/// Loads a whole body like `URLSession.data(for:delegate:)`, for a request that also wants to
/// hear about the response while it loads. `data(for:delegate:)` never calls a delegate's
/// `didReceive response` or `didReceive data`, so this runs a data task and collects the body.
/// - `onResponseStarted` gets the response before the body, unless the whole body arrives with it.
/// - `onData` gets the body as it arrives when the server streams it (see `startsStreaming`), which
///   is then not collected.
/// - `onProgress` gets the bytes received so far, at most every 50 ms and once at the end.
/// - With `responseBytes`, the body is collected into memory that becomes an ArrayBuffer.
final class NitroBufferedTaskDelegate: NSObject, URLSessionDataDelegate {
  typealias Loaded = (body: Data, response: URLResponse, bytes: ArrayBuffer?)

  private static let progressIntervalNs: UInt64 = 50_000_000
  // A body that may still stream is buffered for this long, or up to this size.
  private static let bufferWindowSeconds = 0.4
  private static let bufferWindowBytes = 8 * 1024 * 1024
  // A watched text body streams past this size, so JS decodes it while it
  // downloads, as React Native does. Smaller ones arrive whole.
  private static let streamTextBytes = 256 * 1024
  // A body declared larger than this streams from the start.
  private static let maxBufferedLength: Int64 = 32 * 1024 * 1024
  // A streamed body goes to JS once JS has returned from the last chunk, or
  // once this much has arrived meanwhile.
  private static let streamChunkSize = 64 * 1024

  private let followRedirects: Bool
  private let responseBytes: Bool
  private let onResponseStarted: ((UrlResponseInfo) -> Void)?
  private let onData: ((ArrayBuffer) -> Promise<Bool>)?
  private let onProgress: ((Double, Double) -> Void)?

  // Used only on the session's delegate queue.
  private var response: HTTPURLResponse?
  private var body = Data()
  private var bytes: NitroResponseBytes?
  private var streaming = false
  private var filling = Data()
  private var pendingChunks = 0
  private var refused = false
  private var delegateQueue: OperationQueue?
  private var mayStream = false
  private var streamAfterBytes = NitroBufferedTaskDelegate.bufferWindowBytes
  private var finished = false
  private var reportedResponse = false
  private var expectedLength: Int64 = -1
  private var lengthIsExact = false
  private var received: Int64 = 0
  private var reportedProgress: Int64 = -1
  private var lastProgressNs: UInt64 = 0

  // A task cancelled before it starts can complete before the continuation is set,
  // so the two meet under this lock.
  private let lock = NSLock()
  private var continuation: CheckedContinuation<Loaded, Error>?
  private var result: Result<Loaded, Error>?

  private init(
    followRedirects: Bool,
    responseBytes: Bool,
    onResponseStarted: ((UrlResponseInfo) -> Void)?,
    onData: ((ArrayBuffer) -> Promise<Bool>)?,
    onProgress: ((Double, Double) -> Void)?
  ) {
    self.followRedirects = followRedirects
    self.responseBytes = responseBytes
    self.onResponseStarted = onResponseStarted
    self.onData = onData
    self.onProgress = onProgress
  }

  static func data(
    for request: URLRequest,
    session: URLSession,
    followRedirects: Bool,
    priority: NitroRequestPriority?,
    responseBytes: Bool,
    onResponseStarted: ((UrlResponseInfo) -> Void)?,
    onData: ((ArrayBuffer) -> Promise<Bool>)?,
    onProgress: ((Double, Double) -> Void)?
  ) async throws -> Loaded {
    let delegate = NitroBufferedTaskDelegate(
      followRedirects: followRedirects,
      responseBytes: responseBytes,
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

  private func wait(_ continuation: CheckedContinuation<Loaded, Error>) {
    lock.lock()
    guard let result = result else {
      self.continuation = continuation
      lock.unlock()
      return
    }
    lock.unlock()
    continuation.resume(with: result)
  }

  private func finish(_ result: Result<Loaded, Error>) {
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
    onProgress(Double(received), Double(lengthIsExact ? expectedLength : -1))
  }

  // Hands what was buffered to onData, which then gets the rest as it arrives.
  private func startStreaming() {
    guard !streaming, !finished, onData != nil else { return }
    streaming = true
    reportResponse()
    if let buffered = bytes?.toArrayBuffer() {
      sendChunk(buffered)
    } else if !body.isEmpty {
      filling = body
      sendFilling()
    }
    bytes = nil
    body = Data()
  }

  private func sendChunk(_ chunk: ArrayBuffer) {
    guard let onData = onData, !refused else { return }
    pendingChunks += 1
    let queue = delegateQueue
    onData(chunk)
      .then { [weak self] wanted in queue?.addOperation { self?.chunkHandled(wanted) } }
      .catch { [weak self] _ in queue?.addOperation { self?.chunkHandled(false) } }
  }

  // Runs once JS has returned from a chunk.
  private func chunkHandled(_ wanted: Bool) {
    pendingChunks -= 1
    if !wanted { refused = true }
    if pendingChunks == 0 && !finished { sendFilling() }
  }

  private func sendFilling() {
    guard !filling.isEmpty else { return }
    let data = filling
    filling = Data()
    if let chunk = try? ArrayBuffer.copy(data: data) { sendChunk(chunk) }
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    if let http = response as? HTTPURLResponse {
      self.response = http
      delegateQueue = session.delegateQueue
      expectedLength = http.expectedContentLength
      let encoding = http.value(forHTTPHeaderField: "Content-Encoding")?.lowercased() ?? "identity"
      lengthIsExact = expectedLength >= 0 && encoding == "identity"
      // Without an exact length, the whole body cannot be known to arrive with the head.
      if !lengthIsExact { reportResponse() }
      if responseBytes {
        bytes = NitroResponseBytes(expectedLength: expectedLength, exact: lengthIsExact)
      } else if lengthIsExact && expectedLength > 0 {
        body.reserveCapacity(Int(min(expectedLength, 1 << 20)))
      }
      if onData != nil {
        if !responseBytes { streamAfterBytes = NitroBufferedTaskDelegate.streamTextBytes }
        let streamAbove = responseBytes ? NitroBufferedTaskDelegate.maxBufferedLength : Int64(NitroBufferedTaskDelegate.streamTextBytes)
        if http.startsStreaming || (lengthIsExact && expectedLength > streamAbove) {
          startStreaming()
        } else if !lengthIsExact || (onProgress != nil && !responseBytes) {
          // The server may be streaming: a body that outlives the window streams.
          mayStream = true
          let queue = session.delegateQueue
          DispatchQueue.global().asyncAfter(deadline: .now() + NitroBufferedTaskDelegate.bufferWindowSeconds) { [weak self] in
            queue.addOperation { self?.startStreaming() }
          }
        }
      }
    }
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    received += Int64(data.count)
    if streaming {
      filling.append(data)
      if pendingChunks == 0 || filling.count >= NitroBufferedTaskDelegate.streamChunkSize {
        sendFilling()
      }
      return
    }
    if let bytes = bytes {
      do {
        try bytes.append(data)
      } catch {
        finish(.failure(error))
        dataTask.cancel()
        return
      }
    } else {
      body.append(data)
    }
    if !(lengthIsExact && received >= expectedLength) {
      reportResponse()
    }
    if mayStream && received > streamAfterBytes {
      startStreaming()
      return
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
    if streaming && error == nil { sendFilling() }
    finished = true
    if let error = error {
      finish(.failure(error))
    } else if let response = task.response {
      if !streaming { reportProgress(final: true) }
      finish(.success((body, response, bytes?.toArrayBuffer())))
    } else {
      finish(.failure(URLError(.badServerResponse)))
    }
  }
}
