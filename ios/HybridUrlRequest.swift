import Foundation
import NitroModules

public class HybridUrlRequest: HybridUrlRequestSpec {
  public var memorySize: Int {
    return 0
  }

  public func start() throws {
    // Dummy implementation
  }

  public func followRedirect() throws {
    // Dummy implementation
  }

  public func read(buffer: ArrayBuffer) throws {
    // Dummy implementation
  }

  public func cancel() throws {
    // Dummy implementation
  }

  public func isDone() throws -> Bool {
    return true
  }
}
