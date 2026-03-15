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

 #ifndef NITROFETCH_TEXTDECODERUTILS_H
 #define NITROFETCH_TEXTDECODERUTILS_H
 
 #include <cstdint>
 #include <optional>
 #include <string>
 
 namespace margelo::nitro::nitrofetch {
 
 // Encoding types supported by TextDecoder.
 enum class TextDecoderEncoding : uint8_t {
   UTF8,
   UTF16LE,
   UTF16BE,
   // Additional single-byte encodings could be added here
   _count,
 };
 
 enum class DecodeError {
   None = 0,
   InvalidSequence,  // Invalid byte sequence (fatal mode)
   InvalidSurrogate, // Invalid surrogate (fatal mode)
   OddByteCount,     // Odd byte count in UTF-16 (fatal mode)
 };
 
 // Unicode replacement character U+FFFD
 static constexpr char32_t UNICODE_REPLACEMENT_CHARACTER = 0xFFFD;
 
 // Parse the encoding label and return the corresponding encoding type.
 // Returns std::nullopt if the encoding is not supported.
 std::optional<TextDecoderEncoding> parseEncodingLabel(const std::string &label);
 
 // Get the canonical encoding name for the given encoding type.
 const char *getEncodingName(TextDecoderEncoding encoding);
 
 // Returns the expected UTF-8 sequence length for a valid lead byte.
 // Returns 0 for invalid lead bytes (continuation bytes, 0xC0-0xC1, 0xF5-0xFF).
 unsigned validUTF8SequenceLength(uint8_t byte);
 
 // Check if a partial UTF-8 sequence could possibly be completed to form
 // a valid codepoint. Returns true if the sequence could be valid with more
 // bytes.
 bool isValidPartialUTF8(const uint8_t *bytes, size_t len);
 
 // Unicode 6.3.0, D93b:
 // Maximal subpart of an ill-formed subsequence.
 unsigned maximalSubpartLength(const uint8_t *bytes, size_t available);
 
 // Decode UTF-8 bytes to a UTF-8 string (with validation and error handling).
 // This differs from Hermes which outputs UTF-16 - we keep UTF-8 output
 // since that's what std::string uses.
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
     bool *outBOMSeen);
 
 // Helper: Check if a code point is a high surrogate (D800-DBFF)
 inline bool isHighSurrogate(char32_t cp) {
   return cp >= 0xD800 && cp <= 0xDBFF;
 }
 
 // Helper: Check if a code point is a low surrogate (DC00-DFFF)
 inline bool isLowSurrogate(char32_t cp) {
   return cp >= 0xDC00 && cp <= 0xDFFF;
 }
 
 // Helper: Encode a code point to UTF-8 and append to string
 void appendCodePointAsUTF8(std::string &out, char32_t codePoint);
 
 } // namespace margelo::nitro::nitrofetch
 
 #endif // NITROFETCH_TEXTDECODERUTILS_H