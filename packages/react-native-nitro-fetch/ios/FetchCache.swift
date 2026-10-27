import Foundation

final class FetchCache {
  struct CachedEntry {
    let response: NitroResponse
    let timestampMs: Int64
  }

  private struct PendingEntry {
    let token = UUID()
    var callbacks: [(Result<NitroResponse, Error>) -> Void] = []
  }

  private static let lock = NSLock()
  private static var pending: [String: PendingEntry] = [:]
  private static var results: [String: CachedEntry] = [:]

  static func getPending(_ key: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return pending[key] != nil
  }

  static func beginPending(_ key: String) -> UUID? {
    lock.lock()
    defer { lock.unlock() }
    if pending[key] != nil { return nil }
    let entry = PendingEntry()
    pending[key] = entry
    return entry.token
  }


  static func joinPending(
    _ key: String,
    completion: @escaping (Result<NitroResponse, Error>) -> Void
  ) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard pending[key] != nil else { return false }
    pending[key]?.callbacks.append(completion)
    return true
  }

  static func complete(_ key: String, token: UUID, with result: Result<NitroResponse, Error>) {
    lock.lock()
    // A cleared request must not populate the cache or complete a newer request with the same key.
    guard pending[key]?.token == token else { lock.unlock(); return }
    let callbacks = pending.removeValue(forKey: key)?.callbacks ?? []
    if case let .success(resp) = result {
      results[key] = CachedEntry(response: resp, timestampMs: Int64(Date().timeIntervalSince1970 * 1000))
    }
    lock.unlock()
    // Outside the lock: a callback may re-enter FetchCache.
    callbacks.forEach { $0(result) }
  }

  static func clear() {
    lock.lock()
    let callbacks = pending.values.flatMap { $0.callbacks }
    pending.removeAll()
    results.removeAll()
    lock.unlock()
    callbacks.forEach { $0(.failure(CancellationError())) }
  }

  // maxAgeMs stays a Double: converting a NaN, infinite or out-of-range TTL to
  // Int64 traps. A TTL <= 0 (or NaN) disables cache hits.
  static func getResultIfFresh(_ key: String, maxAgeMs: Double) -> NitroResponse? {
    lock.lock()
    defer { lock.unlock() }
    guard let entry = results[key] else { return nil }
    let age = Int64(Date().timeIntervalSince1970 * 1000) - entry.timestampMs
    if maxAgeMs > 0 && Double(age) <= maxAgeMs { return entry.response }
    results.removeValue(forKey: key)
    return nil
  }
}
