import Foundation
import NitroModules

public class HybridRequestException: HybridRequestExceptionSpec {
  public var memorySize: Int {
    return 0
  }

  public var platform: ExceptionPlatform {
    return .iosPlatform
  }

  public var message: String {
    return "Dummy error message"
  }

  public var code: Double {
    return 0
  }

  public var errorType: ErrorType {
    return .other
  }

  public var internalErrorCode: Double? {
    return nil
  }

  public var networkErrorCode: Double? {
    return nil
  }

  public var quicErrorCode: Double? {
    return nil
  }

  public var stackTrace: String? {
    return nil
  }

  public var errorDomain: Double? {
    return nil
  }

  public var localizedDescription: String? {
    return nil
  }

  public var underlyingError: String? {
    return nil
  }

  public var failingURL: String? {
    return nil
  }

  public var causeMessage: String? {
    return nil
  }
}
