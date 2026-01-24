/*
 * TextDecoder implementation for Nitro.
 *
 * UTF-8 validation and decoding logic adapted from Meta's Hermes TextDecoder:
 * https://github.com/facebook/hermes/blob/static_h/API/hermes/extensions/contrib/TextDecoderUtils.h
 * https://github.com/facebook/hermes/blob/static_h/API/hermes/extensions/contrib/TextDecoderUtils.cpp
 */

#include "HybridTextDecoder.hpp"
#include "TextDecoderUtils.h"

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

// Main decode method - implements WHATWG Encoding Standard
std::string HybridTextDecoder::decode(const std::optional<std::shared_ptr<ArrayBuffer>> &input,
                                      const std::optional<TextDecodeOptions> &options) {
  // Parse stream option
  bool stream = options.has_value() && options->stream.has_value() && options->stream.value();

  // Note: We do NOT reset pending state here even if stream=false.
  // Any pending bytes from previous stream=true calls should be combined
  // with the current input. The state is reset AFTER decoding (see below).

  // Get input bytes
  const uint8_t *inputBytes = nullptr;
  size_t inputLength = 0;

  if (input.has_value() && input.value() && input.value()->data() && input.value()->size() > 0) {
    auto buffer = input.value();
    inputLength = buffer->size();

    if (inputLength > 2147483648UL) {
      throw std::invalid_argument("Input buffer size is too large");
    }

    inputBytes = buffer->data();
  }

  // Combine pending bytes with new input if needed
  std::vector<uint8_t> combined;
  const uint8_t *bytes;
  size_t length;

  if (_pendingCount > 0) {
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

  // Decode using the Hermes-style algorithm
  std::string decoded;
  uint8_t newPendingBytes[4];
  size_t newPendingCount = 0;
  bool newBOMSeen = _bomSeen;

  DecodeError err = decodeUTF8(
      bytes,
      length,
      _fatal,
      _ignoreBOM,
      stream,
      _bomSeen,
      &decoded,
      newPendingBytes,
      &newPendingCount,
      &newBOMSeen);

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
  if (err != DecodeError::None) {
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

// Helper: normalize encoding name
std::string HybridTextDecoder::normalizeEncoding(const std::string &encoding) {
  std::string normalized = encoding;
  std::transform(normalized.begin(), normalized.end(), normalized.begin(), ::tolower);

  if (normalized == "utf8" || normalized == "unicode-1-1-utf-8") {
    return "utf-8";
  }

  return normalized;
}

} // namespace margelo::nitro::nitrofetch
