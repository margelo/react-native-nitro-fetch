//
//  NitroWSPinning.swift
//
//  Duplicate of nitro-fetch's CertificatePinning.swift (pin file parsing, host matching and the
//  SPKI check) for wss:// and the cold-start token refresh. nitro-websockets can't depend on
//  nitro-fetch, so keep the two in sync.
//

import CryptoKit
import Foundation
import Security

enum NitroWSPinning {
  static let configFile = "nitro-fetch-pinning.json"
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

  /// No file means pinning is off. A file that can't be parsed fails every wss:// handshake.
  static let config: Config = {
    guard let url = Bundle.main.url(forResource: configFile, withExtension: nil) else { return .disabled }
    do {
      return parse(try Data(contentsOf: url))
    } catch {
      return .invalid("can't read the file (\(error.localizedDescription))")
    }
  }()

  /// The pins covering `host`, by Cronet's rule like nitro-fetch: walk up from the full host, skip
  /// expired entries, and let the first live entry decide. It applies if it is an exact match or has
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

  /// A chain passes when any of its certificates (leaf, intermediate or root) has a pinned key.
  static func chainMatches(_ trust: SecTrust, _ hashes: Set<Data>) -> Bool {
    let chain = (SecTrustCopyCertificateChain(trust) as? [SecCertificate]) ?? []
    return chain.contains { certificate in
      guard let spki = subjectPublicKeyInfo(of: certificate) else { return false }
      return hashes.contains(Data(SHA256.hash(data: spki)))
    }
  }

  /// The DER SubjectPublicKeyInfo of a certificate, read straight out of it.
  static func subjectPublicKeyInfo(of certificate: SecCertificate) -> Data? {
    let der = [UInt8](SecCertificateCopyData(certificate) as Data)
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
      let count = length & 0x7F
      guard (1...4).contains(count), contentStart + count <= der.count else { return nil }
      length = der[contentStart..<contentStart + count].reduce(0) { $0 << 8 | Int($1) }
      contentStart += count
    }
    let end = contentStart + length
    guard end <= der.count else { return nil }
    return (der[offset], contentStart, end)
  }

  static func parse(_ data: Data) -> Config {
    guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
      return .invalid("expected a JSON object keyed by hostname")
    }
    var domains: [String: DomainPins] = [:]
    for (key, value) in root {
      let host = normalizedHost(key)
      guard isHostname(host) else {
        return .invalid("\"\(key)\" is not a hostname (no scheme, port, path, wildcard or IP; use punycode for IDNs)")
      }
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

/// The pin check for the Objective-C++ transports and the token refresh.
@objc(NitroWSPinningBridge)
public final class NitroWSPinningBridge: NSObject {
  /// Whether a TLS connection to `host` must pass `checkTrust` (every host, if the pin file is invalid).
  @objc(isPinnedHost:)
  public static func isPinned(_ host: String) -> Bool {
    switch NitroWSPinning.config {
    case .disabled: return false
    case .invalid: return true
    case .enabled(let domains): return NitroWSPinning.activePins(for: host, in: domains) != nil
    }
  }

  /// Evaluates `trust` for `host` as the system does, then checks the pins. Returns false if the
  /// connection must fail. `failure` then holds the pinning error, or stays nil for an untrusted
  /// chain, which fails with the platform's own certificate error as with fetch.
  @objc(checkTrust:host:failure:)
  public static func check(_ trust: SecTrust, host: String, failure: AutoreleasingUnsafeMutablePointer<NSString?>) -> Bool {
    let pins: NitroWSPinning.DomainPins
    switch NitroWSPinning.config {
    case .disabled:
      return true
    case .invalid(let reason):
      failure.pointee = "Certificate pinning failed for \(host): invalid \(NitroWSPinning.configFile): \(reason)" as NSString
      return false
    case .enabled(let domains):
      guard let active = NitroWSPinning.activePins(for: host, in: domains) else { return true }
      pins = active
    }
    SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, host as CFString))
    guard SecTrustEvaluateWithError(trust, nil) else { return false }
    guard NitroWSPinning.chainMatches(trust, pins.hashes) else {
      failure.pointee = "Certificate pinning failed for \(host) (\(NitroWSPinning.errorCode))" as NSString
      return false
    }
    return true
  }

  /// Answers a server-trust challenge of a URLSession like nitro-fetch does. Returns the pinning
  /// error if the server was rejected for it.
  @objc(handleChallenge:completionHandler:)
  public static func handle(
    _ challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) -> String? {
    let space = challenge.protectionSpace
    guard space.authenticationMethod == NSURLAuthenticationMethodServerTrust, let trust = space.serverTrust,
          isPinned(space.host) else {
      completionHandler(.performDefaultHandling, nil)
      return nil
    }
    var failure: NSString?
    if check(trust, host: space.host, failure: &failure) {
      completionHandler(.useCredential, URLCredential(trust: trust))
    } else if failure == nil {
      // Default handling rejects the untrusted chain with the system's own error.
      completionHandler(.performDefaultHandling, nil)
    } else {
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
    return failure as String?
  }
}
