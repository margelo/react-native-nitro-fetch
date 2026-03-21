//
//  CaBundle.hpp
//  Pods
//
//  Created by Ritesh Shukla on 20.03.26.
//



#pragma once

#include <string>

namespace margelo::nitro::nitrofetchwebsockets {
#if defined(__ANDROID__)
extern const char kCacertPemData[];
extern const unsigned int kCacertPemLen;
#endif

inline std::string getCaBundlePath() {
#if defined(__ANDROID__)
  return "";
#elif defined(__APPLE__)
  #if defined(PODS_TARGET_SRCROOT)
    return std::string(PODS_TARGET_SRCROOT) + "/cpp/cacert.pem";
  #else
    std::string filePath = __FILE__;
    auto lastSlash = filePath.find_last_of('/');
    if (lastSlash != std::string::npos) {
      return filePath.substr(0, lastSlash + 1) + "cacert.pem";
    }
    return "cacert.pem";
  #endif
#else
  return "";
#endif
}

} // namespace margelo::nitro::nitrofetchwebsockets
