/*
 *
 * Adapted from Hermes TextDecoderUtils for use with Nitro.
 * Original source:
 * https://github.com/facebook/hermes/blob/static_h/API/hermes/extensions/contrib/TextDecoderUtils.h
 * https://github.com/facebook/hermes/blob/static_h/API/hermes/extensions/contrib/TextDecoderUtils.cpp
 */

 #include "TextDecoderUtils.hpp"

 #include <algorithm>
 #include <cctype>
 #include <cstring>
 
 namespace margelo::nitro::nitrotextdecoder {
 
 // Returns the expected UTF-8 sequence length for a valid lead byte.
 // Returns 0 for invalid lead bytes (continuation bytes, 0xC0-0xC1, 0xF5-0xFF).
 // This is stricter than some implementations which return non-zero for
 // some invalid lead bytes.
 __attribute__((always_inline))
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
 __attribute__((always_inline))
 static inline void appendReplacementChar(std::string &out) {
   out.append(kReplacementCharUTF8, 3);
 }

 // Find the length of ASCII-only bytes starting at ptr, up to maxLen.
 // 8-byte scalar scan — no SIMD intrinsics, clang auto-vectorizes at -O2+.
 __attribute__((always_inline))
 static inline size_t findASCIIRunLengthScalar(const uint8_t *ptr, size_t maxLen) {
   size_t len = 0;
   while (len + 8 <= maxLen) {
     uint64_t chunk;
     std::memcpy(&chunk, ptr + len, 8);
     if (chunk & 0x8080808080808080ULL) {
       break;
     }
     len += 8;
   }
   while (len < maxLen && ptr[len] < 0x80) {
     ++len;
   }
   return len;
 }

 // Go-style UTF-8 validator (port of `unicode/utf8.ValidString`).
 // Lead byte → (size:4 | acceptRange:4), one table lookup. Continuation
 // byte(s) validated directly via range compare — no per-byte DFA walk.
 // Roughly 2× tighter than Hoehrmann's DFA on mixed UTF-8 input.
 struct AcceptRange {
   uint8_t lo;
   uint8_t hi;
 };

 // 0: default {0x80,0xBF} — 2-byte leads and mid-continuation bytes.
 // 1: {0xA0,0xBF} — after 0xE0, avoids overlong 3-byte.
 // 2: {0x80,0x9F} — after 0xED, avoids surrogates.
 // 3: {0x90,0xBF} — after 0xF0, avoids overlong 4-byte.
 // 4: {0x80,0x8F} — after 0xF4, avoids > U+10FFFF.
 static constexpr AcceptRange kAcceptRanges[5] = {
   {0x80, 0xBF}, {0xA0, 0xBF}, {0x80, 0x9F}, {0x90, 0xBF}, {0x80, 0x8F},
 };

 // Low nibble = sequence length (1..4). High nibble = acceptRange index.
 // 0xF1 marks invalid leads (continuation bytes or 0xC0/C1/F5..FF).
 static constexpr uint8_t kInvalid = 0xF1;

 static constexpr auto makeLeadTable() {
   struct T { uint8_t v[256]; } t{};
   for (int b = 0; b < 0x80; ++b) t.v[b] = 0x01;        // ASCII
   for (int b = 0x80; b < 0xC2; ++b) t.v[b] = kInvalid; // cont / overlong
   for (int b = 0xC2; b < 0xE0; ++b) t.v[b] = 0x02;     // 2-byte
   for (int b = 0xE1; b < 0xF0; ++b) t.v[b] = 0x03;     // 3-byte default
   t.v[0xE0] = 0x13;                                     // 3-byte range 1
   t.v[0xED] = 0x23;                                     // 3-byte range 2
   for (int b = 0xF1; b < 0xF5; ++b) t.v[b] = 0x04;     // 4-byte default
   t.v[0xF0] = 0x34;                                     // 4-byte range 3
   t.v[0xF4] = 0x44;                                     // 4-byte range 4
   for (int b = 0xF5; b <= 0xFF; ++b) t.v[b] = kInvalid;
   return t;
 }
 static constexpr auto kLeadTable = makeLeadTable();

 // Find the length of contiguous valid UTF-8 bytes starting at ptr, up to
 // maxLen. Stops at first invalid byte or incomplete trailing sequence.
 // Always returns a codepoint-boundary offset.
 size_t findValidUTF8RunLength(const uint8_t *ptr, size_t maxLen) {
   size_t i = 0;
   while (i < maxLen) {
     uint8_t b0 = ptr[i];

     // ASCII fast-path: 8-byte SWAR scan.
     if (b0 < 0x80) [[likely]] {
       i += findASCIIRunLengthScalar(ptr + i, maxLen - i);
       if (i >= maxLen) break;
       b0 = ptr[i];
     }

     uint8_t info = kLeadTable.v[b0];
     uint8_t size = info & 0x0F;
     if (size == 0x01 || info == kInvalid) [[unlikely]] {
       // kInvalid (0xF1) has size nibble F which won't equal 1, so this
       // only triggers on genuine invalid leads. size==1 here would mean
       // we wrongly took the non-ASCII path — impossible since b0 >= 0x80.
       return i;
     }
     if (i + size > maxLen) [[unlikely]] {
       return i; // incomplete trailing sequence
     }

     AcceptRange r = kAcceptRanges[info >> 4];
     uint8_t c1 = ptr[i + 1];
     if (c1 < r.lo || c1 > r.hi) [[unlikely]] {
       return i;
     }
     if (size >= 3) {
       uint8_t c2 = ptr[i + 2];
       if (c2 < 0x80 || c2 > 0xBF) [[unlikely]] return i;
     }
     if (size >= 4) {
       uint8_t c3 = ptr[i + 3];
       if (c3 < 0x80 || c3 > 0xBF) [[unlikely]] return i;
     }
     i += size;
   }
   return i;
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
     // Bulk validate + copy: find the longest run of valid UTF-8 and copy at once.
     size_t validLen = findValidUTF8RunLength(bytes + i, processLength - i);
     if (validLen > 0) [[likely]] {
       decoded->append(reinterpret_cast<const char *>(bytes + i), validLen);
       i += validLen;
       if (i >= processLength) {
         break;
       }
     }

     // We're at an invalid byte.
     if (fatal) [[unlikely]] {
       return DecodeError::InvalidSequence;
     }
     appendReplacementChar(*decoded);
     i += maximalSubpartLength(bytes + i, processLength - i);
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
 
 } // namespace margelo::nitro::nitrotextdecoder