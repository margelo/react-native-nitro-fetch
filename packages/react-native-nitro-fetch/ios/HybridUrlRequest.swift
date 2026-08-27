import Foundation
import NitroModules

class HybridUrlRequest: HybridUrlRequestSpec {
  private weak var task: URLSessionDataTask?
  private weak var delegate: URLSessionDelegate?
  private var isDoneFlag = false
  private let lock = NSLock()
  private var pendingRedirect: (URLRequest, (URLRequest?) -> Void)?

  init(task: URLSessionDataTask, delegate: URLSessionDelegate) {
    self.task = task
    self.delegate = delegate
    super.init()
  }

  func start() throws {
    task?.resume()
  }

  func followRedirect() throws {
    lock.lock()
    let pending = pendingRedirect
    pendingRedirect = nil
    lock.unlock()
    if let (request, completion) = pending { completion(request) }
  }

  func read() throws {
    // Reading is handled automatically by URLSession delegate
    // This is a no-op on iOS but required for API compatibility
  }

  func cancel() throws {
    markDone()
    task?.cancel()
  }

  func isDone() throws -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return isDoneFlag
  }

  func markDone() {
    lock.lock()
    isDoneFlag = true
    let pending = pendingRedirect
    pendingRedirect = nil
    lock.unlock()
    pending?.1(nil)
  }

  func waitForRedirect(_ request: URLRequest, completion: @escaping (URLRequest?) -> Void) {
    lock.lock()
    if isDoneFlag {
      lock.unlock()
      completion(nil)
    } else {
      pendingRedirect = (request, completion)
      lock.unlock()
    }
  }
}
