import Foundation
import NitroModules

final class HybridNitroFetch: HybridNitroFetchSpec {
  func createClient() throws -> (any HybridNitroFetchClientSpec) {
    return HybridNitroFetchClient()
  }

  func saveAutoPrefetchEntry(entryJson: String) throws -> Promise<Void> {
    onPrefetchQueue { NitroAutoPrefetcher.saveAutoPrefetchEntry(entryJson: entryJson, completion: $0) }
  }

  func removeFromAutoPrefetch(prefetchKey: String) throws -> Promise<Void> {
    onPrefetchQueue { NitroAutoPrefetcher.removeFromAutoPrefetch(prefetchKey: prefetchKey, completion: $0) }
  }

  func removeAllFromAutoprefetch() throws -> Promise<Void> {
    onPrefetchQueue { NitroAutoPrefetcher.removeAllFromAutoprefetch(completion: $0) }
  }

  func readAutoPrefetchQueue() throws -> Promise<String> {
    onPrefetchQueue { NitroAutoPrefetcher.readAutoPrefetchQueue(completion: $0) }
  }

  private func onPrefetchQueue<T>(_ task: (@escaping (Result<T, Error>) -> Void) -> Void) -> Promise<T> {
    let promise = Promise<T>()
    task { result in
      switch result {
      case .success(let value): promise.resolve(withResult: value)
      case .failure(let error): promise.reject(withError: error)
      }
    }
    return promise
  }
}
