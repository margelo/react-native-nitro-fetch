#pragma once

#include "HybridNitroTextDecoderSpec.hpp"
#include "simdutf/simdutf.h"
#include <memory>
#include <string>
#include <vector>

namespace margelo::nitro::nitrofetch
{

  // Forward declaration
  struct UTF8DecoderState;

  /**
   * C++ implementation of the `NitroTextDecoder` interface.
   * Implements the WHATWG Encoding Standard UTF-8 decoder algorithm.
   */
  class HybridTextDecoder : public HybridNitroTextDecoderSpec
  {
  public:
    // Constructor with encoding, fatal flag, and ignoreBOM flag
    explicit HybridTextDecoder(const std::string &encoding = "utf-8", bool fatal = false, bool ignoreBOM = false);

    // Destructor (must be in .cpp for unique_ptr with incomplete type)
    ~HybridTextDecoder() override;

  public:
    // Properties (matching web spec TextDecoder interface)
    std::string getEncoding() override;
    bool getFatal() override;
    bool getIgnoreBOM() override;

  public:
    // Methods
    std::string decode(const std::optional<std::shared_ptr<ArrayBuffer>> &input,
                       const std::optional<TextDecodeOptions> &options) override;

  private:
    // Helper methods
    std::string normalizeEncoding(const std::string &encoding);
    std::string serializeStream(const std::vector<int32_t> &codePoints);
    std::string decodeFastPath(const uint8_t *data, size_t length);
    std::string decodeWithSpec(const uint8_t *data, size_t length, bool doNotFlush);

  private:
    std::string _encoding;
    bool _fatal;
    bool _ignoreBOM;
    bool _BOMseen;
    bool _doNotFlush;

    // Decoder state machine (matches web spec algorithm)
    std::unique_ptr<UTF8DecoderState> _decoderState;
  };

} // namespace margelo::nitro::nitrofetch
