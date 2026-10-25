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

  // The response says it is a text/event-stream, so its body arrives over time.
  var isEventStream: Bool {
    guard let contentType = value(forHTTPHeaderField: "Content-Type") else { return false }
    let mimeType = contentType.split(separator: ";", maxSplits: 1).first ?? ""
    return mimeType.trimmingCharacters(in: .whitespaces).lowercased() == "text/event-stream"
  }
}

extension Error {
  func toNitro() -> RequestException {
    return RequestException(message: localizedDescription)
  }
}

extension NitroRequestPriority {
  var taskPriority: Float {
    switch self {
    case .high: return URLSessionTask.highPriority
    case .low: return URLSessionTask.lowPriority
    }
  }
}
