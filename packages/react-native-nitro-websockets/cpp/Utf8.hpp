#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>

namespace margelo::nitro::nitrofetchwebsockets {

inline size_t asciiPrefixLength(const uint8_t* s, size_t len) {
  size_t i = 0;
  while (i + 8 <= len) {
    uint64_t chunk;
    std::memcpy(&chunk, s + i, 8);
    if (chunk & 0x8080808080808080ULL) break;
    i += 8;
  }
  while (i < len && s[i] < 0x80) i++;
  return i;
}

inline bool isWellFormedUtf8(const uint8_t* s, size_t len) {
  size_t i = 0;
  while (i < len) {
    while (i + 8 <= len) {
      uint64_t chunk;
      std::memcpy(&chunk, s + i, 8);
      if (chunk & 0x8080808080808080ULL) break;
      i += 8;
    }
    if (i >= len) break;
    const uint8_t c = s[i];
    if (c < 0x80) {
      i++;
      continue;
    }
    size_t trailing;
    uint8_t min = 0x80;
    uint8_t max = 0xBF;
    if (c >= 0xC2 && c <= 0xDF) {
      trailing = 1;
    } else if (c >= 0xE0 && c <= 0xEF) {
      trailing = 2;
      if (c == 0xE0) min = 0xA0;
      if (c == 0xED) max = 0x9F;
    } else if (c >= 0xF0 && c <= 0xF4) {
      trailing = 3;
      if (c == 0xF0) min = 0x90;
      if (c == 0xF4) max = 0x8F;
    } else {
      return false;
    }
    if (i + trailing >= len) return false;
    if (s[i + 1] < min || s[i + 1] > max) return false;
    for (size_t k = 2; k <= trailing; k++) {
      if ((s[i + k] & 0xC0) != 0x80) return false;
    }
    i += trailing + 1;
  }
  return true;
}

} // namespace margelo::nitro::nitrofetchwebsockets
