import Foundation

@objc
final class NitroFetch: HybridNitroFetchSpec {
  override func createClient() -> NitroFetchClient {
    return NitroFetchClient()
  }
}

