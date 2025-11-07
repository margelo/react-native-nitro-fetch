//
//  NativeStorage.swift
//  Pods
//
//  Created by Ritesh Shukla on 08/11/25.
//

import Foundation


final class NativeStorage: HybridNativeStorageSpec {
  
  private static let suiteName = "nitro_fetch_storage"
  
  private let userDefaults: UserDefaults
  
  public override init() {
    // Use a named suite for better isolation, fallback to standard if creation fails
    if let suite = UserDefaults(suiteName: NativeStorage.suiteName) {
      self.userDefaults = suite
    } else {
      self.userDefaults = UserDefaults.standard
    }
    super.init()
  }
  
  /// Retrieves a string value for the given key.
  ///
  /// - Parameter key: The key to look up in storage
  /// - Returns: The stored string value, or empty string if key doesn't exist
  /// - Throws: RuntimeError if the operation fails
  func getString(key: String) throws -> String {
    guard let value = userDefaults.string(forKey: key) else {
      return ""
    }
    return value
  }
  
  /// Stores a string value with the given key.
  ///
  /// - Parameters:
  ///   - key: The key to store the value under
  ///   - value: The string value to store
  /// - Throws: RuntimeError if the write operation fails
  func setString(key: String, value: String) throws {
    userDefaults.set(value, forKey: key)
    // Synchronize to ensure immediate persistence
    userDefaults.synchronize()
  }
  
  /// Deletes the value associated with the given key.
  /// If the key doesn't exist, this is a no-op.
  ///
  /// - Parameter key: The key to delete from storage
  /// - Throws: RuntimeError if the delete operation fails
  func removeString(key: String) throws {
    userDefaults.removeObject(forKey: key)
    // Synchronize to ensure immediate persistence
    userDefaults.synchronize()
  }
}
