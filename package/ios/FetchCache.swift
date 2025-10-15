import Foundation

final class FetchCache {
  struct CachedEntry {
    let response: NitroResponse
    let timestampMs: Int64
  }

  private static let queue = DispatchQueue(label: "nitrofetch.cache", attributes: .concurrent)
  private static var pending: [String: [(Result<NitroResponse, Error>) -> Void]] = [:]
  private static var results: [String: CachedEntry] = [:]

  static func getPending(_ key: String) -> Bool {
    var has = false
    queue.sync { has = pending[key] != nil }
    return has
  }

  static func addPending(_ key: String, completion: @escaping (Result<NitroResponse, Error>) -> Void) {
    queue.async(flags: .barrier) {
      var arr = pending[key] ?? []
      arr.append(completion)
      pending[key] = arr
    }
  }

  static func complete(_ key: String, with result: Result<NitroResponse, Error>) {
    var callbacks: [(Result<NitroResponse, Error>) -> Void] = []
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

  static func getResultIfFresh(_ key: String, maxAgeMs: Int64) -> NitroResponse? {
    var out: NitroResponse?
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
}

