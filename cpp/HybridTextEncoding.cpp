#include "HybridTextEncoding.hpp"
#include "HybridTextDecoder.hpp"
#include <algorithm>
#include <stdexcept>

namespace margelo::nitro::nitrofetch
{

  HybridTextEncoding::HybridTextEncoding()
      : HybridObject(TAG)
  {
  }

  std::shared_ptr<HybridNitroTextDecoderSpec> HybridTextEncoding::createDecoder(
      const std::optional<std::string> &label,
      const std::optional<TextDecoderOptions> &options)
  {
    // Default to "utf-8" if no label provided
    std::string encoding = label.has_value() ? label.value() : "utf-8";

    // Default to false if no fatal option provided
    bool fatal = (options.has_value() && options->fatal.has_value())
                     ? options->fatal.value()
                     : false;

    // Default to false if no ignoreBOM option provided
    bool ignoreBOM = (options.has_value() && options->ignoreBOM.has_value())
                         ? options->ignoreBOM.value()
                         : false;

    // Validate that only UTF-8 is requested
    std::string normalized = normalizeEncoding(encoding);
    if (normalized != "utf-8")
    {
      throw std::invalid_argument("Unsupported encoding: " + encoding + " (only UTF-8 is supported)");
    }

    return std::make_shared<HybridTextDecoder>(encoding, fatal, ignoreBOM);
  }

  std::string HybridTextEncoding::normalizeEncoding(const std::string &encoding)
  {
    std::string normalized = encoding;

    // Convert to lowercase
    std::transform(normalized.begin(), normalized.end(), normalized.begin(), ::tolower);

    // Handle common aliases
    if (normalized == "utf8")
    {
      return "utf-8";
    }

    return normalized;
  }

} // namespace margelo::nitro::nitrofetch
