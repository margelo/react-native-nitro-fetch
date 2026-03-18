/*
 * SIMD-accelerated ASCII scanning for TextDecoder.
 * Provides 16-byte-at-a-time scanning using ARM NEON or SSE2.
 */

#pragma once

#include <cstddef>
#include <cstdint>

// Detect SIMD support
#if defined(__aarch64__) || defined(_M_ARM64)
  #define TEXTDECODER_HAS_NEON 1
  #include <arm_neon.h>
#elif defined(__x86_64__) || defined(_M_X64) || defined(__i386__) || defined(_M_IX86)
  #if defined(__SSE2__) || defined(_M_X64) || defined(_M_IX86)
    #define TEXTDECODER_HAS_SSE2 1
    #include <emmintrin.h>
  #endif
#endif

namespace margelo::nitro::nitrotextdecoder {

// Find the length of ASCII-only bytes starting at ptr, up to maxLen.
// Uses SIMD (16 bytes/iter) when available, falls back to 8-byte scalar.
__attribute__((always_inline))
static inline size_t findASCIIRunLengthSIMD(const uint8_t *ptr, size_t maxLen) {
  size_t i = 0;

#if defined(TEXTDECODER_HAS_NEON)
  // ARM NEON: process 16 bytes at a time
  while (i + 16 <= maxLen) {
    uint8x16_t chunk = vld1q_u8(ptr + i);
    // Check if any byte has the high bit set (non-ASCII)
    uint8x16_t highBits = vshrq_n_u8(chunk, 7);
    if (vmaxvq_u8(highBits) != 0) {
      break;
    }
    i += 16;
  }
#elif defined(TEXTDECODER_HAS_SSE2)
  // SSE2: process 16 bytes at a time
  while (i + 16 <= maxLen) {
    __m128i chunk = _mm_loadu_si128(reinterpret_cast<const __m128i *>(ptr + i));
    // _mm_movemask_epi8 extracts the high bit of each byte
    int mask = _mm_movemask_epi8(chunk);
    if (mask != 0) {
      break;
    }
    i += 16;
  }
#else
  // Scalar fallback: process 8 bytes at a time
  while (i + 8 <= maxLen) {
    uint64_t chunk;
    __builtin_memcpy(&chunk, ptr + i, 8);
    if (chunk & 0x8080808080808080ULL) {
      break;
    }
    i += 8;
  }
#endif

  // Handle remaining bytes one at a time
  while (i < maxLen && ptr[i] < 0x80) {
    ++i;
  }

  return i;
}

} // namespace margelo::nitro::nitrotextdecoder
