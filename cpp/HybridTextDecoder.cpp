/*
 * TextDecoder implementation for Nitro.
 *
 * UTF-8 validation and decoding logic adapted from Meta's Hermes TextDecoder:
 * https://github.com/facebook/hermes/blob/static_h/API/hermes/extensions/contrib/TextDecoderUtils.h
 * https://github.com/facebook/hermes/blob/static_h/API/hermes/extensions/contrib/TextDecoderUtils.cpp
 */

#include "HybridTextDecoder.hpp"
#include "TextDecoderUtils.h"

#include <NitroModules/HybridObject.hpp>

#include <algorithm>
#include <cstring>
#include <stdexcept>

namespace margelo::nitro::nitrofetch {

// Constructor
HybridTextDecoder::HybridTextDecoder(const std::string &encoding, bool fatal, bool ignoreBOM)
    : HybridObject(TAG),
      _encoding(normalizeEncoding(encoding)),
      _fatal(fatal),
      _ignoreBOM(ignoreBOM),
      _bomSeen(false),
      _pendingCount(0) {
  if (_encoding != "utf-8") {
    throw std::invalid_argument("Unsupported encoding: " + encoding + " (only UTF-8 is supported)");
  }
}

// Destructor
HybridTextDecoder::~HybridTextDecoder() = default;

// Override loadHybridMethods to register our optimized raw decode method
void HybridTextDecoder::loadHybridMethods() {
  // Load base methods (toString, name, etc.)
  HybridObject::loadHybridMethods();

  // Register properties
  registerHybrids(this, [](Prototype &prototype) {
    prototype.registerHybridGetter("encoding", &HybridTextDecoder::getEncoding);
    prototype.registerHybridGetter("fatal", &HybridTextDecoder::getFatal);
    prototype.registerHybridGetter("ignoreBOM", &HybridTextDecoder::getIgnoreBOM);
    // Register RAW decode method - bypasses JSIConverter overhead entirely
    prototype.registerRawHybridMethod("decode", 2, &HybridTextDecoder::decodeRaw);
  });
}

// Getters
std::string HybridTextDecoder::getEncoding() {
  return _encoding;
}

bool HybridTextDecoder::getFatal() {
  return _fatal;
}

bool HybridTextDecoder::getIgnoreBOM() {
  return _ignoreBOM;
}

// Fast path: check if all bytes are ASCII (no high bit set)
static inline bool isAllASCII(const uint8_t *bytes, size_t length) {
  size_t i = 0;

  // Check 8 bytes at a time
  while (i + 8 <= length) {
    uint64_t chunk;
    std::memcpy(&chunk, bytes + i, 8);
    if (chunk & 0x8080808080808080ULL) {
      return false;
    }
    i += 8;
  }

  // Check remaining bytes
  while (i < length) {
    if (bytes[i] & 0x80) {
      return false;
    }
    ++i;
  }

  return true;
}

// Main decode method - typed version (required by base class, but we use raw method instead)
std::string HybridTextDecoder::decode(const std::optional<std::shared_ptr<ArrayBuffer>> &input,
                                      const std::optional<TextDecodeOptions> &options) {
  // Parse stream option
  bool stream = options.has_value() && options->stream.has_value() && options->stream.value();

  // Get input bytes
  const uint8_t *inputBytes = nullptr;
  size_t inputLength = 0;

  if (input.has_value() && input.value() && input.value()->data() && input.value()->size() > 0) {
    auto buffer = input.value();
    inputLength = buffer->size();

    if (inputLength > 2147483648UL) [[unlikely]] {
      throw std::invalid_argument("Input buffer size is too large");
    }

    inputBytes = buffer->data();
  }

  return decodeImpl(inputBytes, inputLength, stream);
}

// Helper: normalize encoding name
std::string HybridTextDecoder::normalizeEncoding(const std::string &encoding) {
  std::string normalized = encoding;
  std::transform(normalized.begin(), normalized.end(), normalized.begin(), ::tolower);

  if (normalized == "utf8" || normalized == "unicode-1-1-utf-8") {
    return "utf-8";
  }

  return normalized;
}

// Core decode implementation - shared by typed and raw methods
std::string HybridTextDecoder::decodeImpl(const uint8_t *inputBytes, size_t inputLength, bool stream) {
  // FAST PATH: No pending bytes and all ASCII with no BOM
  if (_pendingCount == 0 && inputBytes && inputLength > 0) {
    bool canSkipBOM = _ignoreBOM ||
                      inputLength < 3 ||
                      !(inputBytes[0] == 0xEF && inputBytes[1] == 0xBB && inputBytes[2] == 0xBF);

    if (canSkipBOM && isAllASCII(inputBytes, inputLength)) [[likely]] {
      return std::string(reinterpret_cast<const char *>(inputBytes), inputLength);
    }
  }

  // Combine pending bytes with new input if needed
  const uint8_t *bytes;
  size_t length;
  std::vector<uint8_t> combined;

  if (_pendingCount > 0) [[unlikely]] {
    combined.reserve(_pendingCount + inputLength);
    combined.insert(combined.end(), _pendingBytes, _pendingBytes + _pendingCount);
    if (inputBytes && inputLength > 0) {
      combined.insert(combined.end(), inputBytes, inputBytes + inputLength);
    }
    bytes = combined.data();
    length = combined.size();
  } else {
    bytes = inputBytes;
    length = inputLength;
  }

  // Decode
  std::string decoded;
  decoded.reserve(length);

  uint8_t newPendingBytes[4];
  size_t newPendingCount = 0;
  bool newBOMSeen = _bomSeen;

  DecodeError err = decodeUTF8(
      bytes, length, _fatal, _ignoreBOM, stream, _bomSeen,
      &decoded, newPendingBytes, &newPendingCount, &newBOMSeen);

  // Update state
  if (stream) {
    _pendingCount = newPendingCount;
    for (size_t i = 0; i < newPendingCount; ++i) {
      _pendingBytes[i] = newPendingBytes[i];
    }
    _bomSeen = newBOMSeen;
  } else {
    _pendingCount = 0;
    _bomSeen = false;
  }

  // Handle errors
  if (err != DecodeError::None) [[unlikely]] {
    switch (err) {
      case DecodeError::InvalidSequence:
        throw std::invalid_argument("The encoded data was not valid UTF-8");
      case DecodeError::InvalidSurrogate:
        throw std::invalid_argument("Invalid UTF-16: lone surrogate");
      case DecodeError::OddByteCount:
        throw std::invalid_argument("Invalid UTF-16 data (odd byte count)");
      default:
        throw std::invalid_argument("Decoding error");
    }
  }

  return decoded;
}

// Raw JSI decode method - handles ArrayBuffer, TypedArray, DataView directly
// This bypasses all JSIConverter overhead for maximum performance
jsi::Value HybridTextDecoder::decodeRaw(jsi::Runtime &runtime, const jsi::Value &thisVal,
                                        const jsi::Value *args, size_t count) {
  // Get input bytes - handle undefined/null, ArrayBuffer, and TypedArray/DataView
  const uint8_t *inputBytes = nullptr;
  size_t inputLength = 0;

  if (count > 0 && !args[0].isUndefined() && !args[0].isNull()) {
    if (!args[0].isObject()) [[unlikely]] {
      throw jsi::JSError(runtime, "TextDecoder.decode() input must be an ArrayBuffer or TypedArray");
    }

    jsi::Object obj = args[0].asObject(runtime);

    if (obj.isArrayBuffer(runtime)) {
      // Direct ArrayBuffer - most efficient path
      jsi::ArrayBuffer ab = obj.getArrayBuffer(runtime);
      inputBytes = ab.data(runtime);
      inputLength = ab.size(runtime);
    } else {
      // TypedArray or DataView - need to get underlying buffer
      jsi::Value bufferVal = obj.getProperty(runtime, "buffer");
      if (!bufferVal.isObject()) [[unlikely]] {
        throw jsi::JSError(runtime, "TextDecoder.decode() input must be an ArrayBuffer or TypedArray");
      }

      jsi::Object bufferObj = bufferVal.asObject(runtime);
      if (!bufferObj.isArrayBuffer(runtime)) [[unlikely]] {
        throw jsi::JSError(runtime, "TextDecoder.decode() input must be an ArrayBuffer or TypedArray");
      }

      jsi::ArrayBuffer ab = bufferObj.getArrayBuffer(runtime);
      uint8_t *fullData = ab.data(runtime);
      size_t fullSize = ab.size(runtime);

      // Get byteOffset and byteLength - Hermes interns these property names
      jsi::Value offsetVal = obj.getProperty(runtime, "byteOffset");
      jsi::Value lengthVal = obj.getProperty(runtime, "byteLength");

      size_t byteOffset = offsetVal.isNumber() ? static_cast<size_t>(offsetVal.asNumber()) : 0;
      size_t byteLength = lengthVal.isNumber() ? static_cast<size_t>(lengthVal.asNumber()) : fullSize;

      inputBytes = fullData + byteOffset;
      inputLength = byteLength;
    }
  }

  // Parse stream option from second argument
  bool stream = false;
  if (count > 1 && !args[1].isUndefined() && !args[1].isNull() && args[1].isObject()) {
    jsi::Object options = args[1].asObject(runtime);
    jsi::Value streamVal = options.getProperty(runtime, "stream");
    if (streamVal.isBool()) {
      stream = streamVal.getBool();
    }
  }

  // Decode and return string
  try {
    std::string result = decodeImpl(inputBytes, inputLength, stream);
    return jsi::String::createFromUtf8(runtime, result);
  } catch (const std::exception &e) {
    throw jsi::JSError(runtime, e.what());
  }
}

} // namespace margelo::nitro::nitrofetch
