/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Adapted from Hermes TextDecoderUtils for use with Nitro.
 * Original source:
 * https://github.com/facebook/hermes/blob/static_h/API/hermes/extensions/contrib/TextDecoderUtils.h
 * https://github.com/facebook/hermes/blob/static_h/API/hermes/extensions/contrib/TextDecoderUtils.cpp
 */

#include "TextDecoderUtils.h"

#include <algorithm>
#include <cctype>
#include <cstring>

namespace margelo::nitro::nitrofetch {

// Returns the expected UTF-8 sequence length for a valid lead byte.
// Returns 0 for invalid lead bytes (continuation bytes, 0xC0-0xC1, 0xF5-0xFF).
// This is stricter than some implementations which return non-zero for
// some invalid lead bytes.
unsigned validUTF8SequenceLength(uint8_t byte) {
  if (byte < 0x80) {
    return 1; // ASCII
  }
  if (byte < 0xC2) {
    return 0; // Continuation byte or overlong (0xC0, 0xC1)
  }
  if (byte < 0xE0) {
    return 2; // 2-byte sequence (0xC2-0xDF)
  }
  if (byte < 0xF0) {
    return 3; // 3-byte sequence (0xE0-0xEF)
  }
  if (byte < 0xF5) {
    return 4; // 4-byte sequence (0xF0-0xF4)
  }
  return 0; // Invalid (0xF5-0xFF would encode > U+10FFFF)
}

// Check if a partial UTF-8 sequence could possibly be completed to form
// a valid codepoint. Returns true if the sequence could be valid with more
// bytes.
bool isValidPartialUTF8(const uint8_t *bytes, size_t len) {
  if (len == 0) {
    return false;
  }

  uint8_t b0 = bytes[0];
  unsigned expectedLen = validUTF8SequenceLength(b0);
  if (expectedLen == 0 || len >= expectedLen) {
    return false; // Invalid lead or already complete
  }

  // Check second byte constraints for 3 and 4 byte sequences
  if (len >= 2) {
    uint8_t b1 = bytes[1];
    // Must be continuation byte
    if ((b1 & 0xC0) != 0x80) {
      return false;
    }
    if (b0 == 0xE0 && b1 < 0xA0) {
      return false; // Overlong 3-byte
    }
    if (b0 == 0xED && b1 > 0x9F) {
      return false; // Would produce surrogate (D800-DFFF)
    }
    if (b0 == 0xF0 && b1 < 0x90) {
      return false; // Overlong 4-byte
    }
    if (b0 == 0xF4 && b1 > 0x8F) {
      return false; // Would be > U+10FFFF
    }
  }

  // Check third byte for 4-byte sequences
  if (len >= 3) {
    uint8_t b2 = bytes[2];
    if ((b2 & 0xC0) != 0x80) {
      return false;
    }
  }

  return true;
}

// Unicode 6.3.0, D93b:
//   Maximal subpart of an ill-formed subsequence: The longest code unit
//   subsequence starting at an unconvertible offset that is either:
//   a. the initial subsequence of a well-formed code unit sequence, or
//   b. a subsequence of length one.
unsigned maximalSubpartLength(const uint8_t *bytes, size_t available) {
  if (available == 0) {
    return 0;
  }

  // Find the longest prefix that isValidPartialUTF8 returns true for.
  unsigned maxLen = 1;
  for (unsigned len = 2; len <= available && len <= 4; ++len) {
    if (isValidPartialUTF8(bytes, len)) {
      maxLen = len;
    } else {
      break;
    }
  }
  return maxLen;
}

// Helper function to lowercase and trim a string
static std::string toLowerTrimmed(const std::string &s) {
  std::string result;
  result.reserve(s.size());

  // Find first non-whitespace
  size_t start = 0;
  while (start < s.size() && std::isspace(static_cast<unsigned char>(s[start]))) {
    ++start;
  }

  // Find last non-whitespace
  size_t end = s.size();
  while (end > start && std::isspace(static_cast<unsigned char>(s[end - 1]))) {
    --end;
  }

  // Convert to lowercase
  for (size_t i = start; i < end; ++i) {
    result += static_cast<char>(std::tolower(static_cast<unsigned char>(s[i])));
  }

  return result;
}

// Parse the encoding label and return the corresponding encoding type.
// Returns std::nullopt if the encoding is not supported.
std::optional<TextDecoderEncoding> parseEncodingLabel(const std::string &label) {
  std::string trimmed = toLowerTrimmed(label);

  if (trimmed == "unicode-1-1-utf-8" || trimmed == "unicode11utf8" ||
      trimmed == "unicode20utf8" || trimmed == "utf-8" ||
      trimmed == "utf8" || trimmed == "x-unicode20utf8") {
    return TextDecoderEncoding::UTF8;
  }

  if (trimmed == "csunicode" || trimmed == "iso-10646-ucs-2" ||
      trimmed == "ucs-2" || trimmed == "unicode" ||
      trimmed == "unicodefeff" || trimmed == "utf-16" ||
      trimmed == "utf-16le") {
    return TextDecoderEncoding::UTF16LE;
  }

  if (trimmed == "unicodefffe" || trimmed == "utf-16be") {
    return TextDecoderEncoding::UTF16BE;
  }

  // Only supporting UTF-8 for now in this implementation
  return std::nullopt;
}

// Get the canonical encoding name for the given encoding type.
const char *getEncodingName(TextDecoderEncoding encoding) {
  switch (encoding) {
    case TextDecoderEncoding::UTF8:
      return "utf-8";
    case TextDecoderEncoding::UTF16LE:
      return "utf-16le";
    case TextDecoderEncoding::UTF16BE:
      return "utf-16be";
    case TextDecoderEncoding::_count:
      break;
  }
  return "utf-8"; // Default fallback
}

// Append a code point as UTF-8 to a string
void appendCodePointAsUTF8(std::string &out, char32_t codePoint) {
  if (codePoint <= 0x7F) {
    // 1-byte sequence (ASCII)
    out += static_cast<char>(codePoint);
  } else if (codePoint <= 0x7FF) {
    // 2-byte sequence
    out += static_cast<char>(0xC0 | (codePoint >> 6));
    out += static_cast<char>(0x80 | (codePoint & 0x3F));
  } else if (codePoint <= 0xFFFF) {
    // 3-byte sequence
    out += static_cast<char>(0xE0 | (codePoint >> 12));
    out += static_cast<char>(0x80 | ((codePoint >> 6) & 0x3F));
    out += static_cast<char>(0x80 | (codePoint & 0x3F));
  } else if (codePoint <= 0x10FFFF) {
    // 4-byte sequence
    out += static_cast<char>(0xF0 | (codePoint >> 18));
    out += static_cast<char>(0x80 | ((codePoint >> 12) & 0x3F));
    out += static_cast<char>(0x80 | ((codePoint >> 6) & 0x3F));
    out += static_cast<char>(0x80 | (codePoint & 0x3F));
  }
}

// UTF-8 replacement character bytes (U+FFFD encoded as UTF-8)
static constexpr char kReplacementCharUTF8[] = {
    static_cast<char>(0xEF),
    static_cast<char>(0xBF),
    static_cast<char>(0xBD)
};

// Append the replacement character (U+FFFD) as UTF-8
static inline void appendReplacementChar(std::string &out) {
  out.append(kReplacementCharUTF8, 3);
}

// Find the length of ASCII-only bytes starting at ptr, up to maxLen.
// This is the hot path optimization - most data is ASCII.
static inline size_t findASCIIRunLength(const uint8_t *ptr, size_t maxLen) {
  size_t len = 0;

  // Process 8 bytes at a time for better performance
  while (len + 8 <= maxLen) {
    // Check if any byte has high bit set (non-ASCII)
    uint64_t chunk;
    std::memcpy(&chunk, ptr + len, 8);
    if (chunk & 0x8080808080808080ULL) {
      break;
    }
    len += 8;
  }

  // Handle remaining bytes
  while (len < maxLen && ptr[len] < 0x80) {
    ++len;
  }

  return len;
}

// Decode a complete valid UTF-8 sequence starting at bytes and return the
// code point. Assumes the sequence is valid.
static char32_t decodeUTF8Sequence(const uint8_t *bytes, unsigned len) {
  if (len == 1) {
    return bytes[0];
  } else if (len == 2) {
    return ((bytes[0] & 0x1F) << 6) | (bytes[1] & 0x3F);
  } else if (len == 3) {
    return ((bytes[0] & 0x0F) << 12) | ((bytes[1] & 0x3F) << 6) |
           (bytes[2] & 0x3F);
  } else {
    return ((bytes[0] & 0x07) << 18) | ((bytes[1] & 0x3F) << 12) |
           ((bytes[2] & 0x3F) << 6) | (bytes[3] & 0x3F);
  }
}

// Check if a complete sequence is valid (not overlong, not surrogate, not > U+10FFFF)
static bool isValidCompleteSequence(const uint8_t *bytes, unsigned len) {
  if (len == 0) return false;

  uint8_t b0 = bytes[0];
  unsigned expectedLen = validUTF8SequenceLength(b0);
  if (expectedLen == 0 || expectedLen != len) {
    return false;
  }

  // Check continuation bytes
  for (unsigned i = 1; i < len; ++i) {
    if ((bytes[i] & 0xC0) != 0x80) {
      return false;
    }
  }

  // Check for overlong encodings and invalid code points
  if (len == 3) {
    if (b0 == 0xE0 && bytes[1] < 0xA0) {
      return false; // Overlong
    }
    if (b0 == 0xED && bytes[1] > 0x9F) {
      return false; // Surrogate
    }
  } else if (len == 4) {
    if (b0 == 0xF0 && bytes[1] < 0x90) {
      return false; // Overlong
    }
    if (b0 == 0xF4 && bytes[1] > 0x8F) {
      return false; // > U+10FFFF
    }
  }

  return true;
}

// Decode UTF-8 bytes to a UTF-8 string (with validation and error handling).
// Unlike Hermes which outputs UTF-16, we output UTF-8 since that's what
// std::string uses and what our API returns.
DecodeError decodeUTF8(
    const uint8_t *bytes,
    size_t length,
    bool fatal,
    bool ignoreBOM,
    bool stream,
    bool bomSeen,
    std::string *decoded,
    uint8_t outPendingBytes[4],
    size_t *outPendingCount,
    bool *outBOMSeen) {

  *outPendingCount = 0;
  *outBOMSeen = bomSeen;

  // Handle BOM (only strip once at the start of stream)
  // UTF-8 BOM is 0xEF 0xBB 0xBF
  if (!ignoreBOM && !bomSeen && length >= 3 && bytes[0] == 0xEF &&
      bytes[1] == 0xBB && bytes[2] == 0xBF) {
    bytes += 3;
    length -= 3;
    *outBOMSeen = true;
  }

  // Check for incomplete sequence at end. Only process bytes that form complete
  // sequences.
  size_t processLength = length;
  if (length > 0 && stream) {
    // Find potential incomplete sequence at end (up to 3 bytes for 4-byte seq)
    for (size_t tailLen = std::min(length, size_t(3)); tailLen > 0; --tailLen) {
      size_t tailIndex = length - tailLen;
      if (isValidPartialUTF8(bytes + tailIndex, tailLen)) {
        processLength = tailIndex;
        break;
      }
    }
  }

  // Only reserve if not already reserved by caller
  if (decoded->capacity() < decoded->size() + processLength) {
    decoded->reserve(decoded->size() + processLength);
  }

  // Mark BOM as seen once we actually process bytes (not just buffer them).
  if (!*outBOMSeen && processLength > 0) {
    *outBOMSeen = true;
  }

  size_t i = 0;
  while (i < processLength) {
    // OPTIMIZATION: Try to find and bulk-copy ASCII runs first
    // This is the hot path - most text data is ASCII
    size_t asciiLen = findASCIIRunLength(bytes + i, processLength - i);
    if (asciiLen > 0) {
      decoded->append(reinterpret_cast<const char *>(bytes + i), asciiLen);
      i += asciiLen;
      if (i >= processLength) {
        break;
      }
    }

    // Now we're at a non-ASCII byte
    uint8_t b0 = bytes[i];
    unsigned seqLen = validUTF8SequenceLength(b0);

    if (seqLen == 0) [[unlikely]] {
      // Invalid lead byte (continuation byte or 0xC0-0xC1 or 0xF5-0xFF)
      if (fatal) {
        return DecodeError::InvalidSequence;
      }
      appendReplacementChar(*decoded);
      ++i;
      continue;
    }

    // seqLen >= 2 at this point (we already handled ASCII above)

    // Check if we have enough bytes for the complete sequence
    if (i + seqLen > processLength) [[unlikely]] {
      // Incomplete sequence in the middle (not at end) - invalid
      if (fatal) {
        return DecodeError::InvalidSequence;
      }
      appendReplacementChar(*decoded);
      i += maximalSubpartLength(bytes + i, processLength - i);
      continue;
    }

    // Quick validation of continuation bytes and special cases
    // This is faster than calling isValidCompleteSequence for the common case
    bool valid = true;

    // Check all continuation bytes have correct prefix (10xxxxxx)
    for (unsigned j = 1; j < seqLen; ++j) {
      if ((bytes[i + j] & 0xC0) != 0x80) {
        valid = false;
        break;
      }
    }

    if (valid) [[likely]] {
      // Check for overlong encodings and invalid code points
      uint8_t b1 = bytes[i + 1];
      if (seqLen == 3) {
        if ((b0 == 0xE0 && b1 < 0xA0) ||  // Overlong 3-byte
            (b0 == 0xED && b1 > 0x9F)) {   // Surrogate
          valid = false;
        }
      } else if (seqLen == 4) {
        if ((b0 == 0xF0 && b1 < 0x90) ||  // Overlong 4-byte
            (b0 == 0xF4 && b1 > 0x8F)) {   // > U+10FFFF
          valid = false;
        }
      }
    }

    if (valid) [[likely]] {
      // Valid sequence - copy bytes directly (UTF-8 in = UTF-8 out)
      decoded->append(reinterpret_cast<const char *>(bytes + i), seqLen);
      i += seqLen;
    } else {
      // Invalid sequence
      if (fatal) {
        return DecodeError::InvalidSequence;
      }
      appendReplacementChar(*decoded);
      i += maximalSubpartLength(bytes + i, processLength - i);
    }
  }

  // Store pending bytes if streaming; else emit replacement char.
  if (stream && processLength < length) {
    *outPendingCount = length - processLength;
    for (size_t j = 0; j < *outPendingCount; ++j) {
      outPendingBytes[j] = bytes[processLength + j];
    }
  }
  if (!stream && processLength < length) {
    if (fatal) {
      return DecodeError::InvalidSequence;
    }
    appendReplacementChar(*decoded);
  }

  return DecodeError::None;
}

} // namespace margelo::nitro::nitrofetch
