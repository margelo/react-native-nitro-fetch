import Foundation

final class HybridNitroFetch: HybridNitroFetchSpec {
  func createClient() throws -> (any HybridNitroFetchClientSpec) {
    return HybridNitroFetchClient()
  }
  
}

