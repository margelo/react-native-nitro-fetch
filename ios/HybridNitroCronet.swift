import Foundation
import NitroModules

public class HybridNitroCronet: HybridNitroCronetSpec {
  public var memorySize: Int {
    return 0
  }

  public func getEngine() throws -> any HybridCronetEngineSpec {
    return HybridCronetEngine()
  }

  public func createEngine() throws -> any HybridCronetEngineSpec {
    return HybridCronetEngine()
  }

  public func shutdownAll() throws {
    // Dummy implementation
  }

  public func prefetch(
    url: String,
    httpMethod: String,
    headers: Dictionary<String, String>,
    body: Variant_ArrayBuffer_String?,
    maxAge: Double
  ) throws -> Promise<Void> {
    // Dummy implementation - just resolve immediately
    return Promise.async {
      return ()
    }
  }

  public func consumeNativePrefetch(prefetchKey: String) throws -> Promise<CachedFetchResponse?> {
    // Dummy implementation - return nil
    return Promise.async {
      return nil
    }
  }
}
