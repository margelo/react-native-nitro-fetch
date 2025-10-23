import Foundation
import NitroModules

class HybridUrlRequest: HybridUrlRequestSpec {
  private weak var task: URLSessionDataTask?
  private weak var delegate: URLSessionDelegate?
  private var isDoneFlag = false

  init(task: URLSessionDataTask, delegate: URLSessionDelegate) {
    self.task = task
    self.delegate = delegate
    super.init()
  }

  func start() throws {
    task?.resume()
  }

  func followRedirect() throws {
    // Redirects are handled automatically by URLSession
    // This is a no-op on iOS but required for API compatibility
  }

  func read(buffer: ArrayBuffer) throws {
    // Reading is handled automatically by URLSession delegate
    // This is a no-op on iOS but required for API compatibility
  }

  func cancel() throws {
    task?.cancel()
    isDoneFlag = true
  }

  func isDone() throws -> Bool {
    return isDoneFlag
  }

  func markDone() {
    isDoneFlag = true
  }
}
