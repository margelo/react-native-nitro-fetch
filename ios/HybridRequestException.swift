import Foundation
import NitroModules

class HybridRequestException: HybridRequestExceptionSpec {
  var platform: ExceptionPlatform {
    return .iosPlatform
  }

  var message: String {
    return "Dummy error message"
  }

  var code: Double {
    return 0
  }

  var errorType: ErrorType {
    return .other
  }

  var internalErrorCode: Double? {
    return nil
  }

  var networkErrorCode: Double? {
    return nil
  }

  var quicErrorCode: Double? {
    return nil
  }

  var stackTrace: String? {
    return nil
  }

  var errorDomain: Double? {
    return nil
  }

  var localizedDescription: String? {
    return nil
  }

  var underlyingError: String? {
    return nil
  }

  var failingURL: String? {
    return nil
  }

  var causeMessage: String? {
    return nil
  }
}
