import Foundation
import NitroModules

// TEST 1: Uncomment for onSucceeded callback
extension HTTPURLResponse {
  func toNitro() -> UrlResponseInfo {
    let headersMap = allHeaderFields.reduce(into: [String: String]()) { result, pair in
      if let key = pair.key as? String {
        result[key] = String(describing: pair.value)
      }
    }

    let headersList = allHeaderFields.compactMap { pair -> HttpHeader? in
      guard let key = pair.key as? String else { return nil }
      return HttpHeader(key: key, value: String(describing: pair.value))
    }

    return UrlResponseInfo(
      url: url?.absoluteString ?? "",
      httpStatusCode: Double(statusCode),
      httpStatusText: HTTPURLResponse.localizedString(forStatusCode: statusCode),
      allHeaders: headersMap,
      allHeadersAsList: headersList,
      urlChain: [url?.absoluteString ?? ""],
      negotiatedProtocol: "",
      proxyServer: "",
      receivedByteCount: Double(expectedContentLength),
      wasCached: false
    )
  }
}

extension NSError {
  func toNitro() -> RequestException {
    let errorCode = Double(self.code)

    // Determine error type based on domain and code
    let errorType: ErrorType
    if domain == NSURLErrorDomain {
      switch code {
      case NSURLErrorSecureConnectionFailed,
           NSURLErrorServerCertificateHasBadDate,
           NSURLErrorServerCertificateUntrusted,
           NSURLErrorServerCertificateHasUnknownRoot,
           NSURLErrorServerCertificateNotYetValid,
           NSURLErrorClientCertificateRejected,
           NSURLErrorClientCertificateRequired:
        errorType = .security
      case NSURLErrorNotConnectedToInternet,
           NSURLErrorNetworkConnectionLost,
           NSURLErrorDNSLookupFailed,
           NSURLErrorCannotFindHost,
           NSURLErrorCannotConnectToHost,
           NSURLErrorTimedOut:
        errorType = .network
      default:
        errorType = .urlsession
      }
    } else {
      errorType = .other
    }

    return RequestException(
      platform: .iosPlatform,
      message: localizedDescription,
      code: errorCode,
      errorType: errorType,
      internalErrorCode: nil,
      networkErrorCode: errorType == .network ? errorCode : nil,
      quicErrorCode: nil,
      stackTrace: nil,
      errorDomain: Double(domain.hashValue),
      localizedDescription: localizedDescription,
      underlyingError: (userInfo[NSUnderlyingErrorKey] as? NSError)?.localizedDescription,
      failingURL: (userInfo[NSURLErrorFailingURLErrorKey] as? URL)?.absoluteString,
      causeMessage: (userInfo[NSUnderlyingErrorKey] as? NSError)?.localizedDescription
    )
  }
}

extension Error {
  func toNitro() -> RequestException {
    if let nsError = self as? NSError {
      return nsError.toNitro()
    }

    return RequestException(
      platform: .iosPlatform,
      message: localizedDescription,
      code: -1,
      errorType: .other,
      internalErrorCode: nil,
      networkErrorCode: nil,
      quicErrorCode: nil,
      stackTrace: nil,
      errorDomain: nil,
      localizedDescription: localizedDescription,
      underlyingError: nil,
      failingURL: nil,
      causeMessage: nil
    )
  }
}
