import Foundation
import NitroModules

class HybridNitroCronet: HybridNitroCronetSpec {
  // Shared URLSession for all streaming requests
  private static let session: URLSession = {
    let config = URLSessionConfiguration.default
    config.requestCachePolicy = .useProtocolCachePolicy
    config.urlCache = NitroURLCache.shared
    return NitroURLSession.make(configuration: config)
  }()

  // Shared executor queue
  private static let executorQueue = DispatchQueue(
    label: "com.nitrofetch.executor",
    qos: .userInitiated,
    attributes: .concurrent
  )

  func newUrlRequestBuilder(url: String) throws -> any HybridUrlRequestBuilderSpec {
    return try HybridUrlRequestBuilder(
      url: url,
      session: HybridNitroCronet.session,
      executor: HybridNitroCronet.executorQueue
    )
  }
}
