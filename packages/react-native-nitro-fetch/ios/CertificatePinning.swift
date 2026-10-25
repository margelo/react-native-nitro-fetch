import CryptoKit
import Foundation
import Security

/// Optional public-key (SPKI) pinning for every URLSession NitroFetch creates.
///
/// The pins are read once from `nitro-fetch-pinning.json` in the main bundle — the same file and shape
/// Android reads from its assets (and that react-native-ssl-public-key-pinning's `initializeSslPinning` takes):
///   { "api.example.com": { "publicKeyHashes": ["<base64 SHA-256 of the SPKI>", ...],
///                          "includeSubdomains": false, "expirationDate": "2027-01-01" } }
/// No file means pinning is off. A file that can't be parsed fails every TLS handshake, so a broken
/// config never silently turns pinning off. A chain passes when any of its certificates (leaf,
/// intermediate or trust-anchor root) has a pinned key — the same rule Cronet applies on Android.
enum CertificatePinning {
  static let configFile = "nitro-fetch-pinning.json"
  /// The net error Cronet reports for a pin mismatch, reused so JS can detect it the same way on both platforms.
  static let errorCode = "ERR_SSL_PINNED_KEY_NOT_IN_CERT_CHAIN"

  struct DomainPins {
    let hashes: Set<Data>
    let includeSubdomains: Bool
    let expiration: Date?
  }

  enum Config {
    case disabled
    case enabled([String: DomainPins])
    case invalid(String)
  }

  static let config: Config = {
    guard let url = Bundle.main.url(forResource: configFile, withExtension: nil) else { return .disabled }
    let config: Config
    do {
      config = parse(try Data(contentsOf: url))
    } catch {
      config = .invalid("can't read the file (\(error.localizedDescription))")
    }
    switch config {
    case .disabled: break
    case .enabled(let domains): NitroLogger.log("[NitroFetch] Certificate pinning enabled for \(domains.count) host(s)")
    case .invalid(let reason): NitroLogger.log("[NitroFetch] Invalid \(configFile): \(reason). Every HTTPS request will fail.")
    }
    return config
  }()

  /// True when the app ships a pin file, valid or not (an invalid one must still fail closed).
  static var isConfigured: Bool {
    if case .disabled = config { return false }
    return true
  }

  // MARK: - Challenge handling

  // Trust evaluation can take milliseconds (or block on network for an incomplete chain), so it runs
  // here rather than on the session's serial delegate queue, which also delivers streaming chunks.
  private static let evaluationQueue = DispatchQueue(
    label: "com.margelo.nitrofetch.pinning",
    qos: .userInitiated,
    attributes: .concurrent
  )

  /// Answers a server-trust challenge for a pinned host (possibly later, on another queue) and returns true.
  /// Returns false without calling `completion` when default handling applies.
  static func handle(
    _ challenge: URLAuthenticationChallenge,
    completion: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) -> Bool {
    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
          let trust = challenge.protectionSpace.serverTrust else { return false }
    let host = challenge.protectionSpace.host

    switch config {
    case .disabled:
      return false
    case .invalid:
      completion(.cancelAuthenticationChallenge, nil)
      return true
    case .enabled(let domains):
      guard let pins = activePins(for: host, in: domains) else { return false }
      // Evaluate first: it rejects untrusted chains and hostname mismatches, and builds the
      // chain up to the trust anchor so a pinned root matches even though servers never send it.
      // SecTrustEvaluateAsyncWithError must be called on the queue it reports back on.
      evaluationQueue.async {
        SecTrustEvaluateAsyncWithError(trust, evaluationQueue) { trust, trusted, _ in
          guard trusted else {
            // Default handling evaluates this same trust and rejects it too, with the system's own
            // "certificate invalid" error, so only real pin mismatches carry the pinning error.
            completion(.performDefaultHandling, nil)
            return
          }
          guard chainMatches(trust, pins.hashes) else {
            NitroLogger.log("[NitroFetch] Certificate pinning: no pinned key in the chain for \(host)")
            completion(.cancelAuthenticationChallenge, nil)
            return
          }
          completion(.useCredential, URLCredential(trust: trust))
        }
      }
      return true
    }
  }

  /// A rejected challenge reaches the task as NSURLErrorCancelled, which JS would treat as an abort.
  /// Turns it back into a failure when the caller didn't cancel and the host is pinned.
  static func mapFailure(_ error: Error, requestURL: URL?, cancelledByCaller: Bool) -> Error {
    let nsError = error as NSError
    guard !cancelledByCaller,
          nsError.domain == NSURLErrorDomain,
          nsError.code == NSURLErrorCancelled else { return error }
    let url = (nsError.userInfo[NSURLErrorFailingURLErrorKey] as? URL) ?? requestURL
    guard let host = url?.host else { return error }
    let message: String
    switch config {
    case .disabled:
      return error
    case .invalid(let reason):
      message = "Certificate pinning failed for \(host): invalid \(configFile): \(reason)"
    case .enabled(let domains):
      guard activePins(for: host, in: domains) != nil else { return error }
      message = "Certificate pinning failed for \(host) (\(errorCode))"
    }
    return NSError(domain: "NitroFetch", code: NSURLErrorServerCertificateUntrusted, userInfo: [
      NSLocalizedDescriptionKey: message,
    ])
  }

  /// The pins covering `host`, using Cronet's rule so every transport agrees: walk up from the full host,
  /// skip expired entries, and let the first live entry decide. It applies if it is an exact match or has
  /// includeSubdomains; otherwise the host is unpinned, even if a parent entry has includeSubdomains.
  static func activePins(for host: String, in domains: [String: DomainPins], now: Date = Date()) -> DomainPins? {
    var candidate = normalizedHost(host)
    var exact = true
    while true {
      if let pins = domains[candidate], !(pins.expiration.map { $0 <= now } ?? false) {
        return exact || pins.includeSubdomains ? pins : nil
      }
      guard let dot = candidate.firstIndex(of: ".") else { return nil }
      candidate = String(candidate[candidate.index(after: dot)...])
      exact = false
    }
  }

  private static func chainMatches(_ trust: SecTrust, _ hashes: Set<Data>) -> Bool {
    let chain = (SecTrustCopyCertificateChain(trust) as? [SecCertificate]) ?? []
    return chain.contains { certificate in
      guard let spki = subjectPublicKeyInfo(of: certificate) else { return false }
      return hashes.contains(Data(SHA256.hash(data: spki)))
    }
  }

  // MARK: - SPKI extraction

  /// The DER SubjectPublicKeyInfo of a certificate: the bytes that
  /// `openssl x509 -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256` hashes.
  /// Read straight out of the certificate, so every key type (RSA, EC, Ed25519) hashes the same way.
  static func subjectPublicKeyInfo(of certificate: SecCertificate) -> Data? {
    let der = [UInt8](SecCertificateCopyData(certificate) as Data)
    // Certificate ::= SEQUENCE { tbsCertificate SEQUENCE { [0] version OPTIONAL, serialNumber,
    //   signature, issuer, validity, subject, subjectPublicKeyInfo, ... }, ... }
    guard let cert = derElement(der, at: 0), cert.tag == 0x30,
          let tbs = derElement(der, at: cert.contentStart), tbs.tag == 0x30, tbs.end <= cert.end else { return nil }
    var cursor = tbs.contentStart
    if let version = derElement(der, at: cursor), version.tag == 0xA0 { cursor = version.end }
    for _ in 0..<5 { // serialNumber, signature, issuer, validity, subject
      guard let field = derElement(der, at: cursor), field.end <= tbs.end else { return nil }
      cursor = field.end
    }
    guard let spki = derElement(der, at: cursor), spki.tag == 0x30, spki.end <= tbs.end else { return nil }
    return Data(der[cursor..<spki.end])
  }

  private static func derElement(_ der: [UInt8], at offset: Int) -> (tag: UInt8, contentStart: Int, end: Int)? {
    guard offset >= 0, offset + 2 <= der.count else { return nil }
    var length = Int(der[offset + 1])
    var contentStart = offset + 2
    if length & 0x80 != 0 {
      // Long form. 0x80 (indefinite length) isn't valid DER; more than 4 length bytes never occurs in a certificate.
      let count = length & 0x7F
      guard (1...4).contains(count), contentStart + count <= der.count else { return nil }
      length = der[contentStart..<contentStart + count].reduce(0) { $0 << 8 | Int($1) }
      contentStart += count
    }
    let end = contentStart + length
    guard end <= der.count else { return nil }
    return (der[offset], contentStart, end)
  }

  // MARK: - Config parsing

  static func parse(_ data: Data) -> Config {
    guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
      return .invalid("expected a JSON object keyed by hostname")
    }
    let repeated = repeatedKeys(data)
    var domains: [String: DomainPins] = [:]
    for (key, value) in root {
      let host = normalizedHost(key)
      guard isHostname(host) else {
        return .invalid("\"\(key)\" is not a hostname (no scheme, port, path, wildcard or IP; use punycode for IDNs)")
      }
      guard !repeated.contains(key) else { return .invalid("\"\(key)\" lists a host that is already in the file") }
      guard let entry = value as? [String: Any] else { return .invalid("\"\(key)\" must be an object") }

      guard let rawHashes = entry["publicKeyHashes"] as? [Any], !rawHashes.isEmpty else {
        return .invalid("\"\(key)\" needs at least one entry in publicKeyHashes")
      }
      var hashes = Set<Data>()
      for raw in rawHashes {
        guard let string = raw as? String, isCanonicalHash(string), let hash = Data(base64Encoded: string) else {
          return .invalid("\"\(key)\" has a publicKeyHashes entry that isn't a base64 SHA-256 hash: \(raw)")
        }
        hashes.insert(hash)
      }

      var includeSubdomains = false
      if let value = entry["includeSubdomains"] {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else {
          return .invalid("\"\(key)\".includeSubdomains must be true or false")
        }
        includeSubdomains = number.boolValue
      }

      var expiration: Date?
      if let value = entry["expirationDate"] {
        guard let string = value as? String, let date = parseDate(string) else {
          return .invalid("\"\(key)\".expirationDate must be yyyy-MM-dd")
        }
        expiration = date
      }

      guard domains[host] == nil else { return .invalid("\"\(key)\" lists a host that is already in the file") }
      domains[host] = DomainPins(hashes: hashes, includeSubdomains: includeSubdomains, expiration: expiration)
    }
    return domains.isEmpty ? .disabled : .enabled(domains)
  }

  /// The top-level keys that appear more than once. JSONSerialization keeps one value per key, so the
  /// repeats are found in the raw text. `data` must already parse as a JSON object.
  private static func repeatedKeys(_ data: Data) -> Set<String> {
    let bytes = [UInt8](data)
    var seen = Set<String>()
    var repeated = Set<String>()
    var depth = 0
    var expectingKey = false
    var i = 0
    while i < bytes.count {
      switch bytes[i] {
      case UInt8(ascii: "\""):
        let start = i
        i += 1
        while i < bytes.count, bytes[i] != UInt8(ascii: "\"") {
          i += bytes[i] == UInt8(ascii: "\\") ? 2 : 1
        }
        if depth == 1, expectingKey, i < bytes.count {
          // JSONSerialization only for keys with escapes: it is slow to call once per key.
          let raw = bytes[start...i]
          let key = raw.contains(UInt8(ascii: "\\"))
            ? (try? JSONSerialization.jsonObject(with: Data(raw), options: .fragmentsAllowed)) as? String
            : String(decoding: raw.dropFirst().dropLast(), as: UTF8.self)
          if let key = key, !seen.insert(key).inserted { repeated.insert(key) }
        }
        expectingKey = false
      case UInt8(ascii: "{"), UInt8(ascii: "["):
        depth += 1
        expectingKey = depth == 1
      case UInt8(ascii: "}"), UInt8(ascii: "]"):
        depth -= 1
      case UInt8(ascii: ","):
        expectingKey = depth == 1
      default:
        break
      }
      i += 1
    }
    return repeated
  }

  /// A SHA-256 hash in standard, padded base64 is always 43 alphabet characters plus "=".
  private static func isCanonicalHash(_ string: String) -> Bool {
    string.range(of: "^[A-Za-z0-9+/]{43}=$", options: .regularExpression) != nil
  }

  private static func normalizedHost(_ host: String) -> String {
    let lower = host.lowercased()
    return lower.hasSuffix(".") ? String(lower.dropLast()) : lower
  }

  private static func isHostname(_ host: String) -> Bool {
    let label = "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?"
    return host.count <= 253
      && host.range(of: "^\(label)(\\.\(label))*$", options: .regularExpression) != nil
      && host.range(of: "^[0-9.]+$", options: .regularExpression) == nil
  }

  private static func parseDate(_ string: String) -> Date? {
    guard string.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil else { return nil }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.isLenient = false
    return formatter.date(from: string)
  }
}
