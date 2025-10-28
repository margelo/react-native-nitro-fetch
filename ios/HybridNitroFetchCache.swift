import Foundation
import NitroModules

class HybridNitroFetchCache: HybridNitroFetchCacheSpec {
  func getCachedPrefetch(key: String, maxAgeMs: Double) throws -> CachedPrefetchResponse? {
    // Try to get a fresh cached result
    guard let cached = FetchCache.getResultIfFresh(key, maxAgeMs: Int64(maxAgeMs)) else {
      return nil
    }

    // Convert Data to ArrayBuffer
    let arrayBuffer = try ArrayBuffer.copy(data: cached.body)

    return CachedPrefetchResponse(
      url: cached.url,
      statusCode: Double(cached.statusCode),
      statusText: cached.statusText,
      headers: cached.headers,
      body: arrayBuffer,
      timestampMs: Double(cached.timestampMs)
    )
  }

  func isPrefetchPending(key: String) throws -> Bool {
    return FetchCache.getPending(key)
  }

  func clearAll() throws {
    FetchCache.clear()
  }
}
