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

  // MARK: - Challenge handling

  /// The disposition for a server-trust challenge on a pinned host, or nil to fall back to default handling.
  static func evaluate(_ challenge: URLAuthenticationChallenge) -> (URLSession.AuthChallengeDisposition, URLCredential?)? {
    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
          let trust = challenge.protectionSpace.serverTrust else { return nil }
    let host = challenge.protectionSpace.host

    switch config {
    case .disabled:
      return nil
    case .invalid:
      return (.cancelAuthenticationChallenge, nil)
    case .enabled(let domains):
      guard let pins = activePins(for: host, in: domains) else { return nil }
      // Evaluate first: it rejects untrusted chains and hostname mismatches, and builds the
      // chain up to the trust anchor so a pinned root matches even though servers never send it.
      guard SecTrustEvaluateWithError(trust, nil) else {
        NitroLogger.log("[NitroFetch] Certificate pinning: untrusted chain for \(host)")
        return (.cancelAuthenticationChallenge, nil)
      }
      guard chainMatches(trust, pins.hashes) else {
        NitroLogger.log("[NitroFetch] Certificate pinning: no pinned key in the chain for \(host)")
        return (.cancelAuthenticationChallenge, nil)
      }
      return (.useCredential, URLCredential(trust: trust))
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

  /// The most specific entry covering `host`: an exact match, else the closest parent with includeSubdomains.
  /// Expired entries are skipped, so the system's default validation takes over for that host.
  static func activePins(for host: String, in domains: [String: DomainPins], now: Date = Date()) -> DomainPins? {
    var candidate = normalizedHost(host)
    var pins = domains[candidate]
    while pins == nil, let dot = candidate.firstIndex(of: ".") {
      candidate = String(candidate[candidate.index(after: dot)...])
      if let parent = domains[candidate], parent.includeSubdomains { pins = parent }
    }
    guard let pins = pins else { return nil }
    if let expiration = pins.expiration, expiration <= now { return nil }
    return pins
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
    var domains: [String: DomainPins] = [:]
    for (key, value) in root {
      let host = normalizedHost(key.trimmingCharacters(in: .whitespaces))
      guard isHostname(host) else {
        return .invalid("\"\(key)\" is not a hostname (no scheme, port, path, wildcard or IP; use punycode for IDNs)")
      }
      guard let entry = value as? [String: Any] else { return .invalid("\"\(key)\" must be an object") }

      guard let rawHashes = entry["publicKeyHashes"] as? [Any], !rawHashes.isEmpty else {
        return .invalid("\"\(key)\" needs at least one entry in publicKeyHashes")
      }
      var hashes = Set<Data>()
      for raw in rawHashes {
        guard let string = raw as? String, let hash = Data(base64Encoded: string), hash.count == 32 else {
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

      domains[host] = DomainPins(hashes: hashes, includeSubdomains: includeSubdomains, expiration: expiration)
    }
    return domains.isEmpty ? .disabled : .enabled(domains)
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
