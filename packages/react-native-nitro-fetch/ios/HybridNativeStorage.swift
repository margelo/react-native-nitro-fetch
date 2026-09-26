//
//  HybridNativeStorage.swift
//

import CryptoKit
import Foundation
import Security

/// AES-GCM at rest in UserDefaults; 256-bit key in Keychain.
/// Keep `keychainService` and `encPrefix` in sync with `NitroWSSecureAtRest.swift` in nitro-websockets.
internal enum NitroFetchSecureAtRest {
  static let encPrefix = "nfc1:"
  private static let keychainService = "com.margelo.nitrofetch.aesgcm.v1"
  private static let keychainAccount = "master"

  private static func loadOrCreateSymmetricKey() throws -> SymmetricKey {
    if let data = try loadKeyData() {
      return try validatedKey(data)
    }
    var bytes = [UInt8](repeating: 0, count: 32)
    let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    guard status == errSecSuccess else {
      throw NSError(domain: "NitroFetchSecure", code: Int(status), userInfo: nil)
    }
    let data = Data(bytes)
    return try validatedKey(saveKeyData(data))
  }

  private static func validatedKey(_ data: Data) throws -> SymmetricKey {
    guard data.count == 32 else {
      throw NSError(domain: "NitroFetchSecure", code: Int(errSecDecode), userInfo: nil)
    }
    return SymmetricKey(data: data)
  }

  /// Nil only if the key doesn't exist; throws otherwise so a transient Keychain error never regenerates the key.
  private static func loadKeyData() throws -> Data? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: keychainAccount,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var out: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &out)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let d = out as? Data else {
      throw NSError(domain: "NitroFetchSecure", code: Int(status), userInfo: nil)
    }
    return d
  }

  private static func saveKeyData(_ data: Data) throws -> Data {
    let add: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: keychainAccount,
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let status = SecItemAdd(add as CFDictionary, nil)
    // Fetch and WebSocket startup share this master. Never replace a key
    // another caller may already have used to encrypt persisted data.
    if status == errSecDuplicateItem, let existing = try loadKeyData() {
      return existing
    }
    guard status == errSecSuccess else {
      throw NSError(domain: "NitroFetchSecure", code: Int(status), userInfo: nil)
    }
    return data
  }

  private static func encrypt(_ plain: String) throws -> String {
    let key = try loadOrCreateSymmetricKey()
    let sealed = try AES.GCM.seal(Data(plain.utf8), using: key)
    guard let combined = sealed.combined else {
      throw NSError(domain: "NitroFetchSecure", code: -1, userInfo: nil)
    }
    return encPrefix + combined.base64EncodedString()
  }

  private static func decryptPayload(_ b64: String) throws -> String {
    guard let raw = Data(base64Encoded: b64) else {
      throw NSError(domain: "NitroFetchSecure", code: -2, userInfo: nil)
    }
    guard let keyData = try loadKeyData() else {
      throw NSError(domain: "NitroFetchSecure", code: Int(errSecItemNotFound), userInfo: nil)
    }
    let key = try validatedKey(keyData)
    let box = try AES.GCM.SealedBox(combined: raw)
    let data = try AES.GCM.open(box, using: key)
    guard let s = String(data: data, encoding: .utf8) else {
      throw NSError(domain: "NitroFetchSecure", code: -3, userInfo: nil)
    }
    return s
  }

  /// Plaintext, or nil if missing/undecryptable. Migrates legacy plaintext to encrypted.
  static func decryptedString(forKey key: String, defaults: UserDefaults) -> String? {
    guard let stored = defaults.string(forKey: key) else { return nil }
    if stored.isEmpty { return "" }
    if stored.hasPrefix(encPrefix) {
      let payload = String(stored.dropFirst(encPrefix.count))
      return try? decryptPayload(payload)
    }
    setEncrypted(stored, forKey: key, defaults: defaults)
    return stored
  }

  /// Falls back to plaintext if the Keychain is unavailable — never lose the write.
  static func setEncrypted(_ plain: String, forKey key: String, defaults: UserDefaults) {
    let value: String
    do {
      value = try encrypt(plain)
    } catch {
      NitroLogger.log("[NitroFetch] Keychain unavailable — storing \"\(key)\" unencrypted (\(error))")
      value = plain
    }
    defaults.set(value, forKey: key)
    defaults.synchronize()
  }

  static func remove(forKey key: String, defaults: UserDefaults) {
    defaults.removeObject(forKey: key)
    defaults.synchronize()
  }
}

final class HybridNativeStorage: HybridNativeStorageSpec {
  private static let suiteName = "nitro_fetch_storage"

  private let userDefaults: UserDefaults

  public override init() {
    if let suite = UserDefaults(suiteName: HybridNativeStorage.suiteName) {
      self.userDefaults = suite
    } else {
      self.userDefaults = UserDefaults.standard
    }
    super.init()
  }

  func getString(key: String) throws -> String {
    guard let value = userDefaults.string(forKey: key) else {
      return ""
    }
    return value
  }

  func setString(key: String, value: String) throws {
    userDefaults.set(value, forKey: key)
    userDefaults.synchronize()
  }

  func removeString(key: String) throws {
    userDefaults.removeObject(forKey: key)
    userDefaults.synchronize()
  }

  func getSecureString(key: String) throws -> String {
    NitroFetchSecureAtRest.decryptedString(forKey: key, defaults: userDefaults) ?? ""
  }

  func setSecureString(key: String, value: String) throws {
    NitroFetchSecureAtRest.setEncrypted(value, forKey: key, defaults: userDefaults)
  }

  func removeSecureString(key: String) throws {
    NitroFetchSecureAtRest.remove(forKey: key, defaults: userDefaults)
  }
}
