/*
 * TextDecoder implementation for Nitro.
 *
 * UTF-8 validation and decoding logic adapted from Meta's Hermes TextDecoder:
 * https://github.com/facebook/hermes/blob/static_h/API/hermes/extensions/contrib/TextDecoderUtils.h
 * https://github.com/facebook/hermes/blob/static_h/API/hermes/extensions/contrib/TextDecoderUtils.cpp
 */

#pragma once

#include "HybridNitroTextDecoderSpec.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace margelo::nitro::nitrofetch {

/**
 * C++ implementation of the `NitroTextDecoder` interface.
 * Implements the WHATWG Encoding Standard UTF-8 decoder algorithm.
 */
class HybridTextDecoder : public HybridNitroTextDecoderSpec {
public:
  // Constructor with encoding, fatal flag, and ignoreBOM flag
  explicit HybridTextDecoder(const std::string &encoding = "utf-8",
                             bool fatal = false,
                             bool ignoreBOM = false);

  // Destructor
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

private:
  std::string _encoding;
  bool _fatal;
  bool _ignoreBOM;

  // Streaming state (matching Hermes implementation)
  bool _bomSeen;
  uint8_t _pendingBytes[4];
  size_t _pendingCount;
};

} // namespace margelo::nitro::nitrofetch
