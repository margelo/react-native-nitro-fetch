
/*
 * TextDecoder implementation for Nitro.
 *
 * UTF-8 validation and decoding logic adapted from Meta's Hermes TextDecoder:
 * https://github.com/facebook/hermes/blob/static_h/API/hermes/extensions/contrib/TextDecoderUtils.h
 * https://github.com/facebook/hermes/blob/static_h/API/hermes/extensions/contrib/TextDecoderUtils.cpp
 */

 #include "HybridTextDecoder.hpp"
 #include "TextDecoderUtils.hpp"

 #include <NitroModules/HybridObject.hpp>

 #include <algorithm>
 #include <stdexcept>

 namespace margelo::nitro::nitrotextdecoder {
 using namespace margelo::nitro;
 
 // Constructor
 HybridTextDecoder::HybridTextDecoder(const std::string &encoding, bool fatal,
                                      bool ignoreBOM)
     : HybridObject(TAG), _encoding(normalizeEncoding(encoding)), _fatal(fatal),
       _ignoreBOM(ignoreBOM), _bomSeen(false), _pendingCount(0) {
   if (_encoding != "utf-8") {
     throw std::invalid_argument("Unsupported encoding: " + encoding +
                                 " (only UTF-8 is supported)");
   }
 }
 
 // Destructor
 HybridTextDecoder::~HybridTextDecoder() = default;
 
 // Getters
 std::string HybridTextDecoder::getEncoding() { return _encoding; }
 
 bool HybridTextDecoder::getFatal() { return _fatal; }
 
 bool HybridTextDecoder::getIgnoreBOM() { return _ignoreBOM; }
 
 // Typed decode — retained for interface compliance but not actually
 // registered on the prototype. loadHybridMethods below binds "decode" to the
 // raw JSI variant for zero-overhead calls.
 std::string HybridTextDecoder::decode(
     const std::optional<std::shared_ptr<ArrayBuffer>> &input,
     std::optional<double> byteOffset,
     std::optional<double> byteLength,
     const std::optional<TextDecodeOptions> &options) {
   bool stream = options.has_value() && options->stream.has_value() &&
                 options->stream.value();
   const uint8_t *inputBytes = nullptr;
   size_t inputLength = 0;
   if (input.has_value() && input.value() && input.value()->data() &&
       input.value()->size() > 0) {
     auto buffer = input.value();
     size_t bufferSize = buffer->size();
     size_t offset = byteOffset.has_value()
                         ? static_cast<size_t>(byteOffset.value())
                         : 0;
     size_t length = byteLength.has_value()
                         ? static_cast<size_t>(byteLength.value())
                         : (bufferSize - offset);
     if (offset + length > bufferSize) [[unlikely]] {
       throw std::invalid_argument("byteOffset + byteLength exceeds buffer size");
     }
     if (length > 2147483648UL) [[unlikely]] {
       throw std::invalid_argument("Input buffer size is too large");
     }
     inputBytes = buffer->data() + offset;
     inputLength = length;
   }
   return decodeImpl(inputBytes, inputLength, stream);
 }

 // Override loadHybridMethods to bind "decode" to a raw JSI entry point —
 // bypasses std::optional unpacking and shared_ptr<ArrayBuffer> allocation.
 // Skips the spec's auto-registration of the typed decode.
 void HybridTextDecoder::loadHybridMethods() {
   HybridObject::loadHybridMethods();
   registerHybrids(this, [](Prototype &proto) {
     proto.registerHybridGetter("encoding", &HybridTextDecoder::getEncoding);
     proto.registerHybridGetter("fatal", &HybridTextDecoder::getFatal);
     proto.registerHybridGetter("ignoreBOM", &HybridTextDecoder::getIgnoreBOM);
     proto.registerRawHybridMethod("decode", 2, &HybridTextDecoder::decodeRaw);
   });
 }

 // Raw JSI decode. Signature: decode(input?, options?).
 // `input` may be undefined/null, an ArrayBuffer, or a TypedArray/DataView —
 // we read byteOffset/byteLength off the view directly.
 jsi::Value HybridTextDecoder::decodeRaw(jsi::Runtime &runtime,
                                         const jsi::Value & /*thisVal*/,
                                         const jsi::Value *args, size_t count) {
   const uint8_t *inputBytes = nullptr;
   size_t inputLength = 0;

   if (count > 0 && !args[0].isUndefined() && !args[0].isNull()) {
     if (!args[0].isObject()) [[unlikely]] {
       throw jsi::JSError(runtime,
                          "TextDecoder.decode() input must be an ArrayBuffer or TypedArray");
     }
     jsi::Object obj = args[0].asObject(runtime);

     if (obj.isArrayBuffer(runtime)) {
       // Direct ArrayBuffer.
       jsi::ArrayBuffer ab = obj.getArrayBuffer(runtime);
       inputBytes = ab.data(runtime);
       inputLength = ab.size(runtime);
     } else {
       // TypedArray or DataView: read underlying buffer + view offsets.
       jsi::Value bufferVal = obj.getProperty(runtime, "buffer");
       if (!bufferVal.isObject()) [[unlikely]] {
         throw jsi::JSError(runtime,
                            "TextDecoder.decode() input must be an ArrayBuffer or TypedArray");
       }
       jsi::Object bufferObj = bufferVal.asObject(runtime);
       if (!bufferObj.isArrayBuffer(runtime)) [[unlikely]] {
         throw jsi::JSError(runtime,
                            "TextDecoder.decode() input must be an ArrayBuffer or TypedArray");
       }
       jsi::ArrayBuffer ab = bufferObj.getArrayBuffer(runtime);
       uint8_t *fullData = ab.data(runtime);
       size_t fullSize = ab.size(runtime);

       jsi::Value offsetVal = obj.getProperty(runtime, "byteOffset");
       jsi::Value lengthVal = obj.getProperty(runtime, "byteLength");
       size_t offset = offsetVal.isNumber()
                           ? static_cast<size_t>(offsetVal.asNumber())
                           : 0;
       size_t length = lengthVal.isNumber()
                           ? static_cast<size_t>(lengthVal.asNumber())
                           : fullSize;
       if (offset + length > fullSize) [[unlikely]] {
         throw jsi::JSError(runtime,
                            "byteOffset + byteLength exceeds buffer size");
       }
       inputBytes = fullData + offset;
       inputLength = length;
     }
   }

   // Parse { stream } option from args[1].
   bool stream = false;
   if (count > 1 && !args[1].isUndefined() && !args[1].isNull() &&
       args[1].isObject()) {
     jsi::Object options = args[1].asObject(runtime);
     jsi::Value streamVal = options.getProperty(runtime, "stream");
     if (streamVal.isBool()) {
       stream = streamVal.getBool();
     }
   }

   try {
     std::string result = decodeImpl(inputBytes, inputLength, stream);
     return jsi::String::createFromUtf8(runtime, result);
   } catch (const std::exception &e) {
     throw jsi::JSError(runtime, e.what());
   }
 }
 
 // Helper: normalize encoding name
 std::string HybridTextDecoder::normalizeEncoding(const std::string &encoding) {
   std::string normalized = encoding;
   std::transform(normalized.begin(), normalized.end(), normalized.begin(),
                  ::tolower);
 
   if (normalized == "utf8" || normalized == "unicode-1-1-utf-8") {
     return "utf-8";
   }
 
   return normalized;
 }
 
 // Core decode implementation.
 std::string HybridTextDecoder::decodeImpl(const uint8_t *inputBytes,
                                           size_t inputLength, bool stream) {
   // ULTRA-FAST PATH: no pending bytes. Strip BOM (if any), then validate the
   // entire buffer in one pass via findValidUTF8RunLength. If fully valid,
   // return without touching the streaming state machine.
   if (_pendingCount == 0 && inputBytes && inputLength > 0) [[likely]] {
     const uint8_t *dataStart = inputBytes;
     size_t dataLen = inputLength;
     if (!_ignoreBOM && !_bomSeen && dataLen >= 3 &&
         dataStart[0] == 0xEF && dataStart[1] == 0xBB && dataStart[2] == 0xBF) {
       dataStart += 3;
       dataLen -= 3;
     }

     size_t validLen = findValidUTF8RunLength(dataStart, dataLen);
     if (validLen == dataLen) [[likely]] {
       if (stream) {
         _bomSeen = true;
       } else {
         _bomSeen = false;
       }
       return std::string(reinterpret_cast<const char *>(dataStart), dataLen);
     }
     // Not fully valid — fall through to full decode path (handles replacement
     // chars or raises in fatal mode).
   }
 
   // Combine pending bytes with new input if needed
   const uint8_t *bytes;
   size_t length;
   std::vector<uint8_t> combined;
 
   if (_pendingCount > 0) [[unlikely]] {
     combined.reserve(_pendingCount + inputLength);
     combined.insert(combined.end(), _pendingBytes,
                     _pendingBytes + _pendingCount);
     if (inputBytes && inputLength > 0) {
       combined.insert(combined.end(), inputBytes, inputBytes + inputLength);
     }
     bytes = combined.data();
     length = combined.size();
   } else {
     bytes = inputBytes;
     length = inputLength;
   }
 
   // Decode
   std::string decoded;
   decoded.reserve(length);
 
   uint8_t newPendingBytes[4];
   size_t newPendingCount = 0;
   bool newBOMSeen = _bomSeen;
 
   DecodeError err =
       decodeUTF8(bytes, length, _fatal, _ignoreBOM, stream, _bomSeen, &decoded,
                  newPendingBytes, &newPendingCount, &newBOMSeen);
 
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
   if (err != DecodeError::None) [[unlikely]] {
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
 
 } // namespace margelo::nitro::nitrotextdecoder