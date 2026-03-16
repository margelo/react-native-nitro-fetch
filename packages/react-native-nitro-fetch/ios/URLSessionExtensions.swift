import Foundation
import NitroModules

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

extension Error {
  func toNitro() -> RequestException {
    return RequestException(message: localizedDescription)
  }
}
