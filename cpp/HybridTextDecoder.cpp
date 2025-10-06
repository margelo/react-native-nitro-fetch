#include "HybridTextDecoder.hpp"
#include "simdutf/simdutf.h"
#include <algorithm>
#include <stdexcept>
#include <vector>

namespace margelo::nitro::nitrofetch
{

  // Constants matching web spec
  static constexpr int32_t END_OF_STREAM = -1;
  static constexpr int32_t FINISHED = -1;

  /**
   * Helper function matching web spec: inRange(a, min, max)
   */
  static inline bool inRange(uint8_t a, uint8_t min, uint8_t max)
  {
    return min <= a && a <= max;
  }

  /**
   * Helper function matching web spec: decoderError(fatal)
   * Returns U+FFFD replacement character or throws if fatal
   */
  static int32_t decoderError(bool fatal)
  {
    if (fatal)
    {
      throw std::invalid_argument("The encoded data was not valid UTF-8");
    }
    return 0xFFFD; // U+FFFD REPLACEMENT CHARACTER
  }

  /**
   * UTF-8 Decoder State Machine
   * Implements the web spec UTF-8 decoder algorithm exactly
   */
  struct UTF8DecoderState
  {
    // utf-8's decoder has an associated utf-8 code point, utf-8 bytes seen,
    // and utf-8 bytes needed (all initially 0), a utf-8 lower boundary
    // (initially 0x80), and a utf-8 upper boundary (initially 0xBF).
    int32_t utf8CodePoint = 0;
    int32_t utf8BytesSeen = 0;
    int32_t utf8BytesNeeded = 0;
    uint8_t utf8LowerBoundary = 0x80;
    uint8_t utf8UpperBoundary = 0xBF;
    bool fatal = false;

    explicit UTF8DecoderState(bool isFatal) : fatal(isFatal) {}

    /**
     * Handler for processing one byte (or END_OF_STREAM sentinel)
     * Returns: code point (>= 0), null/continue (represented as -2), finished (-1), or error (0xFFFD or throws)
     */
    int32_t handler(int32_t bite, std::vector<uint8_t> *stream = nullptr, size_t *streamPos = nullptr)
    {
      // 1. If byte is end-of-stream and utf-8 bytes needed is not 0,
      // set utf-8 bytes needed to 0 and return error.
      if (bite == END_OF_STREAM && utf8BytesNeeded != 0)
      {
        utf8BytesNeeded = 0;
        return decoderError(fatal);
      }

      // 2. If byte is end-of-stream, return finished.
      if (bite == END_OF_STREAM)
      {
        return FINISHED;
      }

      // 3. If utf-8 bytes needed is 0, based on byte:
      if (utf8BytesNeeded == 0)
      {
        uint8_t byte = static_cast<uint8_t>(bite);

        // 0x00 to 0x7F - ASCII
        if (inRange(byte, 0x00, 0x7F))
        {
          return bite;
        }
        // 0xC2 to 0xDF - 2-byte sequence
        else if (inRange(byte, 0xC2, 0xDF))
        {
          utf8BytesNeeded = 1;
          utf8CodePoint = byte & 0x1F;
        }
        // 0xE0 to 0xEF - 3-byte sequence
        else if (inRange(byte, 0xE0, 0xEF))
        {
          if (byte == 0xE0)
            utf8LowerBoundary = 0xA0; // Prevent overlong
          if (byte == 0xED)
            utf8UpperBoundary = 0x9F; // Prevent surrogates
          utf8BytesNeeded = 2;
          utf8CodePoint = byte & 0x0F;
        }
        // 0xF0 to 0xF4 - 4-byte sequence
        else if (inRange(byte, 0xF0, 0xF4))
        {
          if (byte == 0xF0)
            utf8LowerBoundary = 0x90; // Prevent overlong
          if (byte == 0xF4)
            utf8UpperBoundary = 0x8F; // Prevent > U+10FFFF
          utf8BytesNeeded = 3;
          utf8CodePoint = byte & 0x07;
        }
        // Otherwise - invalid lead byte
        else
        {
          return decoderError(fatal);
        }

        // Return continue (null in JS, -2 here to distinguish from valid 0)
        return -2;
      }

      // 4. If byte is not in the range utf-8 lower boundary to utf-8
      // upper boundary, inclusive, run these substeps:
      uint8_t byte = static_cast<uint8_t>(bite);
      if (!inRange(byte, utf8LowerBoundary, utf8UpperBoundary))
      {
        // Reset state
        utf8CodePoint = 0;
        utf8BytesNeeded = 0;
        utf8BytesSeen = 0;
        utf8LowerBoundary = 0x80;
        utf8UpperBoundary = 0xBF;

        // Prepend byte to stream (reprocess this byte)
        // Insert the byte back into the stream at the current position
        if (stream && streamPos)
        {
          stream->insert(stream->begin() + *streamPos, byte);
        }

        return decoderError(fatal);
      }

      // 5. Set utf-8 lower boundary to 0x80 and utf-8 upper boundary to 0xBF.
      utf8LowerBoundary = 0x80;
      utf8UpperBoundary = 0xBF;

      // 6. Set UTF-8 code point to (UTF-8 code point << 6) | (byte & 0x3F)
      utf8CodePoint = (utf8CodePoint << 6) | (byte & 0x3F);

      // 7. Increase utf-8 bytes seen by one.
      utf8BytesSeen += 1;

      // 8. If utf-8 bytes seen is not equal to utf-8 bytes needed, continue.
      if (utf8BytesSeen != utf8BytesNeeded)
      {
        return -2; // continue
      }

      // 9. Let code point be utf-8 code point.
      int32_t codePoint = utf8CodePoint;

      // 10. Set utf-8 code point, utf-8 bytes needed, and utf-8 bytes seen to 0.
      utf8CodePoint = 0;
      utf8BytesNeeded = 0;
      utf8BytesSeen = 0;

      // 11. Return a code point whose value is code point.
      return codePoint;
    }

    // Check if decoder has incomplete sequence
    bool hasIncompleteSequence() const
    {
      return utf8BytesNeeded > 0;
    }
  };

  /**
   * Converts a code point to UTF-8 string
   */
  static std::string codePointToString(int32_t codePoint)
  {
    std::string result;

    if (codePoint <= 0x7F)
    {
      // 1-byte sequence (ASCII)
      result += static_cast<char>(codePoint);
    }
    else if (codePoint <= 0x7FF)
    {
      // 2-byte sequence
      result += static_cast<char>(0xC0 | (codePoint >> 6));
      result += static_cast<char>(0x80 | (codePoint & 0x3F));
    }
    else if (codePoint <= 0xFFFF)
    {
      // 3-byte sequence
      result += static_cast<char>(0xE0 | (codePoint >> 12));
      result += static_cast<char>(0x80 | ((codePoint >> 6) & 0x3F));
      result += static_cast<char>(0x80 | (codePoint & 0x3F));
    }
    else if (codePoint <= 0x10FFFF)
    {
      // 4-byte sequence
      result += static_cast<char>(0xF0 | (codePoint >> 18));
      result += static_cast<char>(0x80 | ((codePoint >> 12) & 0x3F));
      result += static_cast<char>(0x80 | ((codePoint >> 6) & 0x3F));
      result += static_cast<char>(0x80 | (codePoint & 0x3F));
    }

    return result;
  }

  // Constructor
  HybridTextDecoder::HybridTextDecoder(const std::string &encoding, bool fatal, bool ignoreBOM)
      : HybridObject(TAG), _encoding(normalizeEncoding(encoding)), _fatal(fatal), _ignoreBOM(ignoreBOM), _BOMseen(false), _doNotFlush(false)
  {
    if (_encoding != "utf-8")
    {
      throw std::invalid_argument("Unsupported encoding: " + encoding + " (only UTF-8 is supported)");
    }
  }

  // Destructor (must be defined in .cpp for unique_ptr with incomplete type)
  HybridTextDecoder::~HybridTextDecoder() = default;

  // Getters
  std::string HybridTextDecoder::getEncoding()
  {
    return _encoding;
  }

  bool HybridTextDecoder::getFatal()
  {
    return _fatal;
  }

  bool HybridTextDecoder::getIgnoreBOM()
  {
    return _ignoreBOM;
  }

  // Main decode method - implements web spec algorithm with SIMD fast path
  std::string HybridTextDecoder::decode(const std::optional<std::shared_ptr<ArrayBuffer>> &input,
                                        const std::optional<TextDecodeOptions> &options)
  {
    // 1. If the do not flush flag is unset (OLD value from previous call),
    // set decoder to a new decoder and unset the BOM seen flag
    if (!_doNotFlush)
    {
      _decoderState.reset(new UTF8DecoderState(_fatal));
      _BOMseen = false;
    }

    // 2. If options's stream is true, set the do not flush flag,
    // and unset the do not flush flag otherwise
    _doNotFlush = options.has_value() && options->stream.has_value() && options->stream.value();

    // Get input bytes
    const uint8_t *data = nullptr;
    size_t length = 0;

    if (input.has_value() && input.value() && input.value()->data() && input.value()->size() > 0)
    {
      auto buffer = input.value();
      length = buffer->size();

      if (length > 2147483648UL)
      {
        throw std::invalid_argument("Input buffer size is too large");
      }

      data = buffer->data();
    }

    // OPTIMIZATION: Fast path for complete, valid UTF-8 with no streaming state
    // Only use fast path if:
    // 1. We have data
    // 2. Decoder has no incomplete state (not mid-sequence)
    // 3. We're not in fatal mode (simdutf doesn't give us precise error positions)
    // 4. We are NOT in streaming mode (stream: true) — streaming must always
    //    use the spec-compliant byte-by-byte algorithm to preserve boundary semantics
    if (data && length > 0 && !_fatal && !_decoderState->hasIncompleteSequence())
    {
      std::string fastResult = decodeFastPath(data, length);

      // If fast path succeeded (valid UTF-8), use it
      if (!fastResult.empty() || length == 0)
      {
        // Fast path worked! Handle BOM if needed
        if (!_ignoreBOM && !_BOMseen && fastResult.length() >= 3)
        {
          // Check for UTF-8 BOM: 0xEF 0xBB 0xBF
          if (static_cast<uint8_t>(fastResult[0]) == 0xEF &&
              static_cast<uint8_t>(fastResult[1]) == 0xBB &&
              static_cast<uint8_t>(fastResult[2]) == 0xBF)
          {
            fastResult = fastResult.substr(3);
            _BOMseen = true;
          }
          else if (!fastResult.empty())
          {
            _BOMseen = true;
          }
        }
        else if (!fastResult.empty())
        {
          _BOMseen = true;
        }

        if (!_doNotFlush)
        {
          _decoderState.reset();
          _BOMseen = false;
        }

        return fastResult;
      }
      // Fast path failed (invalid UTF-8), fall through to spec algorithm
    }

    // SLOW PATH: Use web spec byte-by-byte algorithm
    // This handles: streaming, errors, incomplete sequences, fatal mode
    std::string result = decodeWithSpec(data, length, _doNotFlush);

    return result;
  }

  // Fast path using simdutf for complete, valid UTF-8
  std::string HybridTextDecoder::decodeFastPath(const uint8_t *data, size_t length)
  {
    // Quick validation with simdutf
    if (simdutf::validate_utf8(reinterpret_cast<const char *>(data), length))
    {
      // Valid UTF-8! Return as-is
      return std::string(reinterpret_cast<const char *>(data), length);
    }

    // Invalid - return empty to signal fallback needed
    return "";
  }

  // Web spec byte-by-byte algorithm
  std::string HybridTextDecoder::decodeWithSpec(const uint8_t *data, size_t length, bool doNotFlush)
  {
    std::vector<int32_t> output;

    // Process all input bytes
    if (data && length > 0)
    {
      std::vector<uint8_t> bytes(data, data + length);
      size_t pos = 0;

      while (pos < bytes.size())
      {
        int32_t result = _decoderState->handler(static_cast<int32_t>(bytes[pos]), &bytes, &pos);

        // Always advance to next byte
        // (if handler prepended, it inserted the byte back into the vector)
        pos++;

        if (result == FINISHED)
          break;

        // -2 means continue (null in JS spec)
        if (result != -2)
        {
          output.push_back(result);
        }
      }
    }

    // Web spec: If do not flush flag is unset, flush incomplete sequences
    if (!doNotFlush)
    {
      // Process END_OF_STREAM to flush any incomplete sequences
      while (true)
      {
        int32_t result = _decoderState->handler(END_OF_STREAM);
        if (result == FINISHED)
          break;
        if (result != -2)
        {
          output.push_back(result);
        }
      }
      // Reset decoder state and BOM flag
      _decoderState.reset();
      _BOMseen = false;
    }

    // Serialize stream - convert code points to string
    return serializeStream(output);
  }

  // Helper: serialize code points to UTF-8 string with BOM handling
  std::string HybridTextDecoder::serializeStream(const std::vector<int32_t> &codePoints)
  {
    // Handle BOM per web spec
    size_t startIndex = 0;

    if (!_ignoreBOM && !_BOMseen && !codePoints.empty() && codePoints[0] == 0xFEFF)
    {
      // BOM detected at start - skip it
      _BOMseen = true;
      startIndex = 1;
    }
    else if (!codePoints.empty())
    {
      _BOMseen = true;
    }

    // Convert code points to UTF-8 string
    std::string result;
    result.reserve(codePoints.size() * 2); // Rough estimate

    for (size_t i = startIndex; i < codePoints.size(); ++i)
    {
      result += codePointToString(codePoints[i]);
    }

    return result;
  }

  // Helper: normalize encoding name
  std::string HybridTextDecoder::normalizeEncoding(const std::string &encoding)
  {
    std::string normalized = encoding;
    std::transform(normalized.begin(), normalized.end(), normalized.begin(), ::tolower);

    if (normalized == "utf8" || normalized == "unicode-1-1-utf-8")
    {
      return "utf-8";
    }

    return normalized;
  }

} // namespace margelo::nitro::nitrofetch
