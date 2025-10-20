import Foundation
import NitroModules

/**
 * Unified request exception for iOS that implements the HybridRequestExceptionSpec.
 * This class consolidates all error types (network, security, callback, etc.) into a single
 * exception type with iOS-specific details.
 */
final class NitroRequestException: HybridRequestExceptionSpec {

  private let msg: String
  private let errorCode: Double
  private let errType: ErrorType
  private let errDomain: Double?
  private let localizedDesc: String?
  private let underlying: String?
  private let failURL: String?
  private let cause: String?

  private init(
    message: String,
    code: Double,
    errorType: ErrorType,
    errorDomain: Double? = nil,
    localizedDescription: String? = nil,
    underlyingError: String? = nil,
    failingURL: String? = nil,
    causeMessage: String? = nil
  ) {
    self.msg = message
    self.errorCode = code
    self.errType = errorType
    self.errDomain = errorDomain
    self.localizedDesc = localizedDescription
    self.underlying = underlyingError
    self.failURL = failingURL
    self.cause = causeMessage
    super.init()
  }

  var platform: ExceptionPlatform {
    return .iosPlatform
  }

  var message: String {
    return msg
  }

  var code: Double {
    return errorCode
  }

  var errorType: ErrorType {
    return errType
  }

  var errorDomain: Double? {
    return errDomain
  }

  var localizedDescription: String? {
    return localizedDesc
  }

  var underlyingError: String? {
    return underlying
  }

  var failingURL: String? {
    return failURL
  }

  var causeMessage: String? {
    return cause
  }

  // Android-specific fields (always nil on iOS)
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

  // MARK: - Factory Methods

  /**
   * Create a base URLSession exception
   */
  static func urlSession(
    message: String,
    code: Double,
    domain: Double,
    localizedDescription: String?
  ) -> NitroRequestException {
    return NitroRequestException(
      message: message,
      code: code,
      errorType: .urlsession,
      errorDomain: domain,
      localizedDescription: localizedDescription
    )
  }

  /**
   * Create a network exception with underlying error details
   */
  static func network(
    message: String,
    code: Double,
    domain: Double,
    localizedDescription: String?,
    underlyingError: String?
  ) -> NitroRequestException {
    return NitroRequestException(
      message: message,
      code: code,
      errorType: .network,
      errorDomain: domain,
      localizedDescription: localizedDescription,
      underlyingError: underlyingError
    )
  }

  /**
   * Create a security exception (SSL/TLS errors)
   */
  static func security(
    message: String,
    code: Double,
    domain: Double,
    localizedDescription: String?,
    failingURL: String?
  ) -> NitroRequestException {
    return NitroRequestException(
      message: message,
      code: code,
      errorType: .security,
      errorDomain: domain,
      localizedDescription: localizedDescription,
      failingURL: failingURL
    )
  }

  /**
   * Create a callback exception (error in delegate methods)
   */
  static func callback(
    message: String,
    code: Double,
    domain: Double,
    localizedDescription: String?,
    causeMessage: String?
  ) -> NitroRequestException {
    return NitroRequestException(
      message: message,
      code: code,
      errorType: .callback,
      errorDomain: domain,
      localizedDescription: localizedDescription,
      causeMessage: causeMessage
    )
  }

  /**
   * Create an exception from an NSError
   */
  static func from(error: NSError) -> NitroRequestException {
    let domain = errorDomainValue(from: error.domain)
    let underlyingError = (error.userInfo[NSUnderlyingErrorKey] as? NSError)?.localizedDescription

    return NitroRequestException(
      message: error.localizedDescription,
      code: Double(error.code),
      errorType: .other,
      errorDomain: domain,
      localizedDescription: error.localizedDescription,
      underlyingError: underlyingError
    )
  }

  /**
   * Create a generic exception
   */
  static func other(
    message: String,
    code: Double
  ) -> NitroRequestException {
    return NitroRequestException(
      message: message,
      code: code,
      errorType: .other
    )
  }

  // MARK: - Helper Methods

  private static func errorDomainValue(from domain: String) -> Double {
    if domain == NSURLErrorDomain {
      return 0
    } else if domain == NSPOSIXErrorDomain {
      return 1
    } else if domain == (kCFErrorDomainCFNetwork as String) {
      return 2
    } else if domain == (kCFErrorDomainOSStatus as String) {
      return 3
    } else {
      return 0
    }
  }

}
