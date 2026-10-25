import Foundation
import NitroModules

/// A body returned as bytes. Each chunk is copied once, into memory that then becomes the
/// ArrayBuffer, instead of collecting a `Data` and copying it into an ArrayBuffer at the end.
final class NitroResponseBytes {
  // Bodies declared larger than this start smaller and grow, in case the server lies.
  private static let maxPresize = 32 * 1024 * 1024

  private var pointer: UnsafeMutableRawPointer?
  private var capacity = 0
  private(set) var count = 0

  init(expectedLength: Int64, exact: Bool) {
    if exact && expectedLength > 0 && expectedLength <= Int64(NitroResponseBytes.maxPresize) {
      pointer = malloc(Int(expectedLength))
      capacity = pointer == nil ? 0 : Int(expectedLength)
    }
  }

  deinit {
    free(pointer)
  }

  func append(_ data: Data) throws {
    let needed = count + data.count
    if needed > capacity {
      let grownCapacity = max(needed, min(capacity * 2, Int.max / 2), 64 * 1024)
      guard let grown = realloc(pointer, grownCapacity) else {
        throw NSError(domain: "NitroFetch", code: -5, userInfo: [NSLocalizedDescriptionKey: "Response body too large"])
      }
      pointer = grown
      capacity = grownCapacity
    }
    guard let pointer = pointer else { return }
    data.copyBytes(to: pointer.advanced(by: count).assumingMemoryBound(to: UInt8.self), count: data.count)
    count = needed
  }

  /// Hands the bytes over to a new ArrayBuffer, which frees them.
  func toArrayBuffer() -> ArrayBuffer? {
    guard let pointer = pointer, count > 0 else { return nil }
    self.pointer = nil
    return ArrayBuffer.wrap(dataWithoutCopy: pointer, size: count, onDelete: { free(pointer) })
  }
}
