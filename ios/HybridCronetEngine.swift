import Foundation
import NitroModules

class HybridCronetEngine: HybridCronetEngineSpec {
  func newUrlRequestBuilder(url: String, callback: UrlRequestCallback) throws -> any HybridUrlRequestBuilderSpec {
    return HybridUrlRequestBuilder()
  }

  func shutdown() throws {
    // Dummy implementation
  }

  func getVersionString() throws -> String {
    return "1.0.0-dummy"
  }

  func startNetLogToFile(fileName: String, logAll: Bool) throws {
    // Dummy implementation
  }

  func stopNetLog() throws {
    // Dummy implementation
  }
}
