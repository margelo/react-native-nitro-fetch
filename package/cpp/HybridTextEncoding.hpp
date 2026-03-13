#pragma once

#include "../nitrogen/generated/shared/c++/HybridNitroTextEncodingSpec.hpp"
#include "HybridTextDecoder.hpp"
#include <memory>
#include <string>

namespace margelo::nitro::nitrofetch
{

  /**
   * C++ implementation of the `NitroTextEncoding` interface.
   * Factory for creating text decoders with different encodings.
   */
  class HybridTextEncoding : public HybridNitroTextEncodingSpec
  {
  public:
    // Constructor
    explicit HybridTextEncoding();

    // Destructor
    ~HybridTextEncoding() override = default;

  public:
    // Methods
    std::shared_ptr<HybridNitroTextDecoderSpec> createDecoder(
        const std::optional<std::string> &label,
        const std::optional<TextDecoderOptions> &options) override;

  private:
    // Helper methods
    std::string normalizeEncoding(const std::string &encoding);
  };

} // namespace margelo::nitro::nitrofetch
