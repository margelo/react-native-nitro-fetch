//
//  Duplicate of nitro-fetch NativeStorage.swift `NitroFetchSecureAtRest` — keep
//  `keychainService`, `encPrefix`, and Keychain account in sync.
//

import CryptoKit
import Foundation
import Security

enum NitroWSSecureAtRest {
  static let encPrefix = "nfc1:"
  private static let keychainService = "com.margelo.nitrofetch.aesgcm.v1"
  private static let keychainAccount = "master"

  private static func loadOrCreateSymmetricKey() throws -> SymmetricKey {
    if let data = try? loadKeyData(), data.count == 32 {
      return SymmetricKey(data: data)
    }
    var bytes = [UInt8](repeating: 0, count: 32)
    let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    guard status == errSecSuccess else {
      throw NSError(domain: "NitroWSSecure", code: Int(status), userInfo: nil)
    }
    let data = Data(bytes)
    try saveKeyData(data)
    return SymmetricKey(data: data)
  }

  private static func loadKeyData() throws -> Data {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: keychainAccount,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var out: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &out)
    guard status == errSecSuccess, let d = out as? Data else {
      throw NSError(domain: "NitroWSSecure", code: Int(status), userInfo: nil)
    }
    return d
  }

  private static func saveKeyData(_ data: Data) throws {
    let deleteQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: keychainAccount,
    ]
    SecItemDelete(deleteQuery as CFDictionary)
    let add: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: keychainAccount,
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let status = SecItemAdd(add as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw NSError(domain: "NitroWSSecure", code: Int(status), userInfo: nil)
    }
  }

  private static func encrypt(_ plain: String) throws -> String {
    let key = try loadOrCreateSymmetricKey()
    let sealed = try AES.GCM.seal(Data(plain.utf8), using: key)
    guard let combined = sealed.combined else {
      throw NSError(domain: "NitroWSSecure", code: -1, userInfo: nil)
    }
    return encPrefix + combined.base64EncodedString()
  }

  private static func decryptPayload(_ b64: String) throws -> String {
    guard let raw = Data(base64Encoded: b64) else {
      throw NSError(domain: "NitroWSSecure", code: -2, userInfo: nil)
    }
    let key = try loadOrCreateSymmetricKey()
    let box = try AES.GCM.SealedBox(combined: raw)
    let data = try AES.GCM.open(box, using: key)
    guard let s = String(data: data, encoding: .utf8) else {
      throw NSError(domain: "NitroWSSecure", code: -3, userInfo: nil)
    }
    return s
  }

  static func decryptedString(forKey key: String, defaults: UserDefaults) -> String? {
    guard let stored = defaults.string(forKey: key) else { return nil }
    if stored.isEmpty { return "" }
    if stored.hasPrefix(encPrefix) {
      let payload = String(stored.dropFirst(encPrefix.count))
      if let s = try? decryptPayload(payload) { return s }
      return stored
    }
    _ = try? setEncrypted(stored, forKey: key, defaults: defaults)
    return stored
  }

  static func setEncrypted(_ plain: String, forKey key: String, defaults: UserDefaults) throws {
    let enc = try encrypt(plain)
    defaults.set(enc, forKey: key)
    defaults.synchronize()
  }
}

@objc(NitroWSSecureAtRestBridge)
public final class NitroWSSecureAtRestBridge: NSObject {
  @objc public static func decryptedString(forKey key: String, suiteName: String) -> String? {
    let ud = UserDefaults(suiteName: suiteName) ?? .standard
    return NitroWSSecureAtRest.decryptedString(forKey: key, defaults: ud)
  }

  @objc public static func setEncrypted(_ plain: String, forKey key: String, suiteName: String) {
    let ud = UserDefaults(suiteName: suiteName) ?? .standard
    try? NitroWSSecureAtRest.setEncrypted(plain, forKey: key, defaults: ud)
  }
}
