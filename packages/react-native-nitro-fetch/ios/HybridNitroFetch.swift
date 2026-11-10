import Foundation
import NitroModules

final class HybridNitroFetch: HybridNitroFetchSpec {
  func createClient() throws -> (any HybridNitroFetchClientSpec) {
    return HybridNitroFetchClient()
  }

  func prefetchOnAppStart(entryJson: String) throws -> Promise<Void> {
    onPrefetchQueue { NitroAutoPrefetcher.prefetchOnAppStart(entryJson: entryJson, completion: $0) }
  }

  func removeFromAutoPrefetch(prefetchKey: String) throws -> Promise<Void> {
    onPrefetchQueue { NitroAutoPrefetcher.removeFromAutoPrefetch(prefetchKey: prefetchKey, completion: $0) }
  }

  func removeAllFromAutoprefetch() throws -> Promise<Void> {
    onPrefetchQueue { NitroAutoPrefetcher.removeAllFromAutoprefetch(completion: $0) }
  }

  private func onPrefetchQueue(_ update: (@escaping () -> Void) -> Void) -> Promise<Void> {
    let promise = Promise<Void>.init()
    update { promise.resolve(withResult: ()) }
    return promise
  }
  
}

