import Foundation

final class NitroFetch: HybridNitroFetchSpec {
  func createClient() throws -> (any HybridNitroFetchClientSpec) {
    return NitroFetchClient()
  }
  
}

