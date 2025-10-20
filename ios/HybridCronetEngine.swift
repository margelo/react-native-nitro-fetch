import Foundation
import NitroModules

public class HybridCronetEngine: HybridCronetEngineSpec {
  public var memorySize: Int {
    return 0
  }

  public func newUrlRequestBuilder(url: String, callback: UrlRequestCallback) throws -> any HybridUrlRequestBuilderSpec {
    return HybridUrlRequestBuilder()
  }

  public func shutdown() throws {
    // Dummy implementation
  }

  public func getVersionString() throws -> String {
    return "1.0.0-dummy"
  }

  public func startNetLogToFile(fileName: String, logAll: Bool) throws {
    // Dummy implementation
  }

  public func stopNetLog() throws {
    // Dummy implementation
  }
}
