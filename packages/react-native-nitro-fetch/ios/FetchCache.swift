import Foundation

final class FetchCache {
  struct CachedEntry {
    let response: NitroResponse
    let timestampMs: Double
  }

  private static let lock = NSLock()
  private static var pending: [String: [(Result<NitroResponse, Error>) -> Void]] = [:]
  private static var results: [String: CachedEntry] = [:]

  static func getPending(_ key: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return pending[key] != nil
  }

  static func beginPending(_ key: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    if pending[key] != nil { return false }
    pending[key] = []
    return true
  }


  static func joinPending(
    _ key: String,
    completion: @escaping (Result<NitroResponse, Error>) -> Void
  ) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard pending[key] != nil else { return false }
    pending[key]?.append(completion)
    return true
  }

  static func complete(_ key: String, with result: Result<NitroResponse, Error>) {
    lock.lock()
    let callbacks = pending.removeValue(forKey: key) ?? []
    if case let .success(resp) = result {
      results[key] = CachedEntry(response: resp, timestampMs: ProcessInfo.processInfo.systemUptime * 1000)
    }
    lock.unlock()
    // Outside the lock: a callback may re-enter FetchCache.
    callbacks.forEach { $0(result) }
  }

  static func getResultIfFresh(_ key: String, maxAgeMs: Double) -> NitroResponse? {
    lock.lock()
    defer { lock.unlock() }
    guard let entry = results[key] else { return nil }
    let age = ProcessInfo.processInfo.systemUptime * 1000 - entry.timestampMs
    if maxAgeMs.isFinite && maxAgeMs > 0 && age <= maxAgeMs { return entry.response }
    results.removeValue(forKey: key)
    return nil
  }
}
