import Foundation
import NitroModules

class HybridNitroFetchCache: HybridNitroFetchCacheSpec {
  func getCachedPrefetch(key: String, maxAgeMs: Double) throws -> CachedPrefetchResponse? {
    return nil
  }

  func isPrefetchPending(key: String) throws -> Bool {
    return false
  }

  func clearAll() throws {
    // Dummy implementation
  }
}
