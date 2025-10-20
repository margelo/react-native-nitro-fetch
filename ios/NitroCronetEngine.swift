import Foundation
import NitroModules

/**
 * Cronet Engine implementation for iOS using URLSession.
 * Note: iOS doesn't have native Cronet, so this provides a compatible interface.
 */
final class NitroCronetEngine: HybridCronetEngineSpec {

  private let session: URLSession
  private let queue: OperationQueue

  override init() {
    let config = URLSessionConfiguration.default
    config.requestCachePolicy = .useProtocolCachePolicy
    config.urlCache = URLCache(
      memoryCapacity: 32 * 1024 * 1024,
      diskCapacity: 100 * 1024 * 1024,
      diskPath: "nitrofetch_cronet_cache"
    )

    self.queue = OperationQueue()
    self.queue.name = "com.margelo.nitrofetch.cronet"
    self.queue.maxConcurrentOperationCount = OperationQueue.defaultMaxConcurrentOperationCount

    self.session = URLSession(configuration: config, delegate: nil, delegateQueue: self.queue)
    super.init()
  }

  func newUrlRequestBuilder(url: String, callback: UrlRequestCallback) throws -> any HybridUrlRequestBuilderSpec {
    return NitroUrlRequestBuilder(
      session: session,
      url: url,
      callback: callback
    )
  }

  func shutdown() throws {
    session.invalidateAndCancel()
  }

  func invalidateSession() {
    session.invalidateAndCancel()
  }

  func getVersionString() throws -> String {
    return "URLSession/iOS"
  }

  func startNetLogToFile(fileName: String, logAll: Bool) throws {
    // iOS URLSession doesn't support net logging like Cronet
    // This is a no-op but maintains API compatibility
  }

  func stopNetLog() throws {
    // iOS URLSession doesn't support net logging like Cronet
    // This is a no-op but maintains API compatibility
  }
}
