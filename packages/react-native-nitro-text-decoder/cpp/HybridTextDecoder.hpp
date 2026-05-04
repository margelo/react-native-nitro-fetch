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
 #include <jsi/jsi.h>
 #include <string>
 #include <vector>

 namespace margelo::nitro::nitrotextdecoder {

 namespace jsi = facebook::jsi;
 
 /**
  * C++ implementation of the `NitroTextDecoder` interface.
  * Implements the WHATWG Encoding Standard UTF-8 decoder algorithm.
  */
 class HybridTextDecoder : public HybridNitroTextDecoderSpec {
 public:
   // Constructor with encoding, fatal flag, and ignoreBOM flag
   explicit HybridTextDecoder(const std::string &encoding = "utf-8",
                              bool fatal = false, bool ignoreBOM = false);
 
   // Destructor
   ~HybridTextDecoder() override;
 
 public:
   // Properties (matching web spec TextDecoder interface)
   std::string getEncoding() override;
   bool getFatal() override;
   bool getIgnoreBOM() override;
 
 public:
   // Methods - typed version (required by base class signature, unused at
   // runtime: we override loadHybridMethods to register a raw-JSI decode).
   std::string decode(const std::optional<std::shared_ptr<ArrayBuffer>> &input,
                      std::optional<double> byteOffset,
                      std::optional<double> byteLength,
                      const std::optional<TextDecodeOptions> &options) override;

   // Raw JSI decode: bypasses Nitro's JSIConverter overhead (no std::optional
   // unpacking, no shared_ptr<ArrayBuffer>, reads TypedArray byteOffset/length
   // directly from the JS object). Hot path for fetch streaming.
   jsi::Value decodeRaw(jsi::Runtime &runtime, const jsi::Value &thisVal,
                        const jsi::Value *args, size_t count);

 protected:
   // Override to register "decode" as a raw method instead of Nitro's auto
   // typed registration.
   void loadHybridMethods() override;

 private:
   // Core decode implementation used by both typed and raw methods
   std::string decodeImpl(const uint8_t *inputBytes, size_t inputLength,
                          bool stream);
 
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
 
 } // namespace margelo::nitro::nitrotextdecoder