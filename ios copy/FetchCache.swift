import Foundation

/**
 * Response data that can be cached
 */
struct CachedResponse {
  let url: String
  let statusCode: Int
  let statusText: String
  let headers: [String: String]
  let body: Data
  let timestampMs: Int64
  let maxAgeMs: Int64
}

/**
 * Cache for managing pending and completed fetch requests.
 * Used for prefetch functionality to avoid duplicate requests.
 */
final class FetchCache {
  private static let queue = DispatchQueue(label: "nitrofetch.cache", attributes: .concurrent)
  private static var pending: [String: [(Result<CachedResponse, Error>) -> Void]] = [:]
  private static var results: [String: CachedResponse] = [:]

  /**
   * Check if a prefetch is currently pending
   */
  static func getPending(_ key: String) -> Bool {
    var has = false
    queue.sync {
      has = pending[key] != nil
    }
    return has
  }

  /**
   * Register a completion handler for a pending prefetch
   */
  static func addPending(_ key: String, completion: @escaping (Result<CachedResponse, Error>) -> Void) {
    queue.async(flags: .barrier) {
      var arr = pending[key] ?? []
      arr.append(completion)
      pending[key] = arr
    }
  }

  /**
   * Register a new pending prefetch without a completion handler
   */
  static func setPending(_ key: String) {
    queue.async(flags: .barrier) {
      if pending[key] == nil {
        pending[key] = []
      }
    }
  }

  /**
   * Complete a pending prefetch and notify all waiting handlers
   */
  static func complete(_ key: String, with result: Result<CachedResponse, Error>) {
    var callbacks: [(Result<CachedResponse, Error>) -> Void] = []
    queue.sync {
      callbacks = pending[key] ?? []
    }
    queue.async(flags: .barrier) {
      pending.removeValue(forKey: key)
      if case let .success(resp) = result {
        results[key] = resp
      }
    }
    callbacks.forEach { $0(result) }
  }

  /**
   * Get a cached result if it's still fresh (within maxAgeMs), and remove it from cache
   */
  static func getResultIfFresh(_ key: String, maxAgeMs: Int64? = nil) -> CachedResponse? {
    var out: CachedResponse?
    queue.sync {
      if let entry = results[key] {
        let age = Int64(Date().timeIntervalSince1970 * 1000) - entry.timestampMs
        let effectiveMaxAge = maxAgeMs ?? entry.maxAgeMs
        if age <= effectiveMaxAge {
          out = entry
        }
      }
    }
    // Remove from cache after retrieving (consume once)
    if out != nil {
      queue.async(flags: .barrier) {
        results.removeValue(forKey: key)
      }
    }
    return out
  }

  /**
   * Clear all cached and pending requests
   */
  static func clear() {
    queue.async(flags: .barrier) {
      pending.removeAll()
      results.removeAll()
    }
  }
}
