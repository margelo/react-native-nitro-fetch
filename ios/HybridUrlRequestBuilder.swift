import Foundation
import NitroModules

class HybridUrlRequestBuilder: HybridUrlRequestBuilderSpec {
  func setHttpMethod(httpMethod: String) throws {
    // Dummy implementation
  }

  func addHeader(name: String, value: String) throws {
    // Dummy implementation
  }

  func setUploadDataProvider(provider: UploadDataProvider) throws {
    // Dummy implementation
  }

  func setUploadBody(body: Variant_ArrayBuffer_String) throws {
    // Dummy implementation
  }

  func disableCache() throws {
    // Dummy implementation
  }

  func setPriority(priority: Double) throws {
    // Dummy implementation
  }

  func allowDirectExecutor() throws {
    // Dummy implementation
  }

  func build() throws -> any HybridUrlRequestSpec {
    return HybridUrlRequest()
  }
}
