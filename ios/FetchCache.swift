import Foundation
import NitroModules

/**
 * Cache for managing pending and completed fetch requests.
 * Used for prefetch functionality to avoid duplicate requests.
 * Implements the HybridNitroFetchCacheSpec protocol.
 */
final class FetchCache: HybridNitroFetchCacheSpec {

  struct CachedEntry {
    let response: CachedPrefetchResponse
    let timestampMs: Int64
  }

  private static let queue = DispatchQueue(label: "nitrofetch.cache", attributes: .concurrent)
  private static var pending: [String: [(Result<CachedPrefetchResponse, Error>) -> Void]] = [:]
  private static var results: [String: CachedEntry] = [:]

  static func getPending(_ key: String) -> Bool {
    var has = false
    queue.sync { has = pending[key] != nil }
    return has
  }

  static func addPending(_ key: String, completion: @escaping (Result<CachedPrefetchResponse, Error>) -> Void) {
    queue.async(flags: .barrier) {
      var arr = pending[key] ?? []
      arr.append(completion)
      pending[key] = arr
    }
  }

  static func complete(_ key: String, with result: Result<CachedPrefetchResponse, Error>) {
    var callbacks: [(Result<CachedPrefetchResponse, Error>) -> Void] = []
    queue.sync {
      callbacks = pending[key] ?? []
    }
    queue.async(flags: .barrier) {
      pending.removeValue(forKey: key)
      if case let .success(resp) = result {
        results[key] = CachedEntry(response: resp, timestampMs: Int64(Date().timeIntervalSince1970 * 1000))
      }
    }
    callbacks.forEach { $0(result) }
  }

  static func getResultIfFresh(_ key: String, maxAgeMs: Int64) -> CachedPrefetchResponse? {
    var out: CachedPrefetchResponse?
    queue.sync {
      if let entry = results[key] {
        let age = Int64(Date().timeIntervalSince1970 * 1000) - entry.timestampMs
        if age <= maxAgeMs {
          out = entry.response
        } else {
          results.removeValue(forKey: key)
        }
      }
    }
    return out
  }

  // MARK: - HybridNitroFetchCacheSpec protocol implementation

  func getCachedPrefetch(key: String, maxAgeMs: Double) throws -> CachedPrefetchResponse? {
    return FetchCache.getResultIfFresh(key, maxAgeMs: Int64(maxAgeMs))
  }

  func isPrefetchPending(key: String) throws -> Bool {
    return FetchCache.getPending(key)
  }

  func clearAll() throws {
    FetchCache.queue.async(flags: .barrier) {
      FetchCache.pending.removeAll()
      FetchCache.results.removeAll()
    }
  }
}
