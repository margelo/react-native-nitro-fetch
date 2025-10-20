import Foundation
import NitroModules

public class HybridNitroFetchCache: HybridNitroFetchCacheSpec {
  public var memorySize: Int {
    return 0
  }

  public func getCachedPrefetch(key: String, maxAgeMs: Double) throws -> CachedPrefetchResponse? {
    return nil
  }

  public func isPrefetchPending(key: String) throws -> Bool {
    return false
  }

  public func clearAll() throws {
    // Dummy implementation
  }
}
