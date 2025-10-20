import Foundation
import NitroModules

public class HybridUrlRequestBuilder: HybridUrlRequestBuilderSpec {
  public var memorySize: Int {
    return 0
  }

  public func setHttpMethod(httpMethod: String) throws {
    // Dummy implementation
  }

  public func addHeader(name: String, value: String) throws {
    // Dummy implementation
  }

  public func setUploadDataProvider(provider: UploadDataProvider) throws {
    // Dummy implementation
  }

  public func setUploadBody(body: Variant_ArrayBuffer_String) throws {
    // Dummy implementation
  }

  public func disableCache() throws {
    // Dummy implementation
  }

  public func setPriority(priority: Double) throws {
    // Dummy implementation
  }

  public func allowDirectExecutor() throws {
    // Dummy implementation
  }

  public func build() throws -> any HybridUrlRequestSpec {
    return HybridUrlRequest()
  }
}
