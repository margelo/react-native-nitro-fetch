import Foundation

/// Flip `enabled` to log in release builds too.
enum NitroLogger {
#if DEBUG
  static var enabled = true
#else
  static var enabled = false
#endif

  static func log(_ message: @autoclosure () -> String) {
    if enabled { print(message()) }
  }
}
