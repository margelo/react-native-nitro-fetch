//
//  CaBundle.hpp
//  Pods
//
//  Created by Ritesh Shukla on 20.03.26.
//



#pragma once

namespace margelo::nitro::nitrofetchwebsockets {

// Embedded Mozilla CA bundle — generated at build time from cpp/cacert.pem.
// Available on both Android (CMakeLists.txt) and iOS (podspec prepare_command).
#if defined(__ANDROID__) || defined(__APPLE__)
extern const char kCacertPemData[];
extern const unsigned int kCacertPemLen;
#endif

} // namespace margelo::nitro::nitrofetchwebsockets
