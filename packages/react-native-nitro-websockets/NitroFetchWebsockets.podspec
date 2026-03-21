require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "NitroFetchWebsockets"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported, :visionos => 1.0 }
  s.source       = { :git => "https://github.com/mrousavy/nitro.git", :tag => "#{s.version}" }

  s.source_files = [
    # Implementation (Swift)
    "ios/**/*.{swift}",
    # Autolinking/Registration (Objective-C++)
    "ios/**/*.{m,mm}",
    # Implementation (C++ objects)
    "cpp/**/*.{hpp,cpp}",
  ]

  # ── Build libwebsockets + mbedTLS for iOS ─────────────────────────────────
  #
  # This prepare_command runs once at `pod install` time.
  # Sources live in thirdparty/ as git submodules (run
  # `git submodule update --init --recursive` before pod install).
  # It cmake-builds static archives for device (arm64) and
  # simulator (arm64 + x86_64), lipo's the simulator slices, then
  # wraps everything in XCFrameworks so both device and M-series
  # simulator work without EXCLUDED_ARCHS hacks.
  s.prepare_command = <<-CMD
    set -e
    ROOT="$(pwd)/thirdparty"

    build_for_arch() {
      local ARCH="$1"
      local SDK="$2"
      local DIR_SUFFIX="${3:-${ARCH}}"
      local DEST="$ROOT/build_${DIR_SUFFIX}"
      local SYSROOT
      SYSROOT="$(xcrun --sdk $SDK --show-sdk-path)"

      echo "=== Building mbedTLS for $ARCH ($SDK) ==="
      cmake -S "$ROOT/mbedtls" -B "$DEST/mbedtls" \
        -DCMAKE_SYSTEM_NAME=iOS \
        -DCMAKE_OSX_ARCHITECTURES="$ARCH" \
        -DCMAKE_OSX_SYSROOT="$SYSROOT" \
        -DCMAKE_OSX_DEPLOYMENT_TARGET=15.1 \
        -DCMAKE_INSTALL_PREFIX="$DEST/install" \
        -DCMAKE_BUILD_TYPE=Release \
        -DENABLE_TESTING=OFF \
        -DENABLE_PROGRAMS=OFF \
        -DUSE_SHARED_MBEDTLS_LIBRARY=OFF \
        -DUSE_STATIC_MBEDTLS_LIBRARY=ON \
        -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
        -Wno-dev
      cmake --build "$DEST/mbedtls" --config Release --target install -- -j$(sysctl -n hw.logicalcpu)

      echo "=== Building libwebsockets for $ARCH ($SDK) ==="
      cmake -S "$ROOT/libwebsockets" -B "$DEST/lws" \
        -DCMAKE_SYSTEM_NAME=iOS \
        -DCMAKE_OSX_ARCHITECTURES="$ARCH" \
        -DCMAKE_OSX_SYSROOT="$SYSROOT" \
        -DCMAKE_OSX_DEPLOYMENT_TARGET=15.1 \
        -DCMAKE_INSTALL_PREFIX="$DEST/install" \
        -DCMAKE_BUILD_TYPE=Release \
        -DIOS=TRUE \
        -DLWS_WITH_MBEDTLS=ON \
        -DLWS_WITH_SSL=ON \
        -DLWS_WITH_SHARED=OFF \
        -DLWS_WITH_STATIC=ON \
        -DLWS_WITHOUT_SERVER=ON \
        -DLWS_WITHOUT_TESTAPPS=ON \
        -DLWS_WITHOUT_TEST_SERVER=ON \
        -DLWS_WITHOUT_DAEMONIZE=ON \
        -DLWS_WITH_LIBUV=OFF \
        -DLWS_WITH_ZLIB=OFF \
        -DLWS_WITH_HTTP2=OFF \
        -DMBEDTLS_INCLUDE_DIRS="$DEST/install/include" \
        -DMBEDTLS_LIBRARIES="$DEST/install/lib/libmbedtls.a;$DEST/install/lib/libmbedx509.a;$DEST/install/lib/libmbedcrypto.a" \
        -DLWS_HAVE_mbedtls_md_setup=1 \
        -DLWS_HAVE_mbedtls_net_init=1 \
        -DLWS_HAVE_mbedtls_rsa_complete=1 \
        -DLWS_HAVE_mbedtls_ssl_conf_alpn_protocols=1 \
        -DLWS_HAVE_mbedtls_ssl_get_alpn_protocol=1 \
        -DLWS_HAVE_mbedtls_ssl_conf_sni=1 \
        -DLWS_HAVE_mbedtls_ssl_set_hs_ca_chain=1 \
        -DLWS_HAVE_mbedtls_ssl_set_hs_own_cert=1 \
        -DLWS_HAVE_mbedtls_ssl_set_hs_authmode=1 \
        -DLWS_HAVE_mbedtls_ssl_set_verify=1 \
        -DLWS_HAVE_mbedtls_x509_crt_parse_file=1 \
        -DLWS_HAVE_mbedtls_internal_aes_encrypt=0 \
        -Wno-dev
      cmake --build "$DEST/lws" --config Release --target websockets -- -j$(sysctl -n hw.logicalcpu)

      # cmake --target websockets_static doesn't run install; copy manually.
      mkdir -p "$DEST/install/lib"
      find "$DEST/lws" -name "libwebsockets.a" | head -1 | xargs -I{} cp {} "$DEST/install/lib/"
    }

    [ -f "$ROOT/build_arm64/install/lib/libwebsockets.a" ]    || build_for_arch arm64 iphoneos
    [ -f "$ROOT/build_x86_64/install/lib/libwebsockets.a" ]   || build_for_arch x86_64 iphonesimulator
    [ -f "$ROOT/build_arm64_sim/install/lib/libwebsockets.a" ] || build_for_arch arm64 iphonesimulator arm64_sim

    # Create fat simulator lib (x86_64 + arm64 simulator slices)
    SIM_FAT="$ROOT/build_sim_fat/lib"
    mkdir -p "$SIM_FAT"
    for LIB in libwebsockets libmbedtls libmbedx509 libmbedcrypto; do
      lipo -create \
        "$ROOT/build_x86_64/install/lib/${LIB}.a" \
        "$ROOT/build_arm64_sim/install/lib/${LIB}.a" \
        -output "$SIM_FAT/${LIB}.a"
    done

    # Wrap into XCFrameworks so CocoaPods selects the right slice automatically.
    XCFW="$ROOT/xcframeworks"
    mkdir -p "$XCFW"
    for LIB in libwebsockets libmbedtls libmbedx509 libmbedcrypto; do
      [ -d "$XCFW/${LIB}.xcframework" ] && continue
      xcodebuild -create-xcframework \
        -library "$ROOT/build_arm64/install/lib/${LIB}.a" \
        -library "$SIM_FAT/${LIB}.a" \
        -output "$XCFW/${LIB}.xcframework"
    done

    echo "=== libwebsockets iOS build complete ==="

    # Generate embedded CA bundle (same approach as Android's CMakeLists.txt).
    # LwsContext uses client_ssl_ca_mem so the PEM lives in the binary — no
    # filesystem access needed on physical devices.
    # NOTE: Use python3 -c '...' (single-quoted shell string) to avoid
    # Ruby's <<-CMD heredoc interpreting <<'PYEOF' as a nested Ruby heredoc.
    # Use chr(10) for newlines and chr(34) for double-quotes to avoid any
    # escape sequences that Ruby would expand before the shell sees the script.
    if [ ! -f "cpp/cacert_pem.cpp" ]; then
      python3 -c 'n=chr(10); q=chr(34); pem=open("cpp/cacert.pem").read(); open("cpp/cacert_pem.cpp","w").write("namespace margelo::nitro::nitrofetchwebsockets {"+n+"extern const char kCacertPemData[] = R"+q+"CACERT("+pem+")CACERT"+q+";"+n+"extern const unsigned int kCacertPemLen = sizeof(kCacertPemData) - 1;"+n+"}"+n)'
    fi
  CMD

  s.vendored_frameworks = [
    "thirdparty/xcframeworks/libwebsockets.xcframework",
    "thirdparty/xcframeworks/libmbedtls.xcframework",
    "thirdparty/xcframeworks/libmbedx509.xcframework",
    "thirdparty/xcframeworks/libmbedcrypto.xcframework",
  ]

  load 'nitrogen/generated/ios/NitroFetchWebsockets+autolinking.rb'
  add_nitrogen_files(s)

  # The C++ spec headers (HybridHybridWebSocketSpec.hpp etc.) chain to
  # <regex> via NitroModules/HybridObjectPrototype.hpp → HybridFunction.hpp
  # → NitroTypeInfo.hpp. When Xcode builds the Clang module (for Swift interop)
  # it fails because <regex> isn't resolved in module-build mode.
  # Fix: keep only the empty bridge header as public (used for Swift/C++ interop)
  # and make all C++ spec + implementation headers private. They're still
  # compiled and accessible via header search paths — just not in the module map.
  s.public_header_files = [
    "nitrogen/generated/ios/NitroFetchWebsockets-Swift-Cxx-Bridge.hpp",
  ]
  s.private_header_files = [
    "cpp/**/*.hpp",
    "nitrogen/generated/shared/**/*.{h,hpp}",
    "nitrogen/generated/ios/c++/**/*.{h,hpp}",
  ]

  # Merge with what add_nitrogen_files already set (CLANG_CXX_LANGUAGE_STANDARD,
  # SWIFT_OBJC_INTEROP_MODE, DEFINES_MODULE) rather than replacing it.
  current_xcconfig = s.attributes_hash['pod_target_xcconfig'] || {}
  s.pod_target_xcconfig = current_xcconfig.merge({
    'HEADER_SEARCH_PATHS' => [
      '"${PODS_TARGET_SRCROOT}/thirdparty/libwebsockets/include"',
      '"${PODS_TARGET_SRCROOT}/thirdparty/build_arm64/lws"',
      '"${PODS_TARGET_SRCROOT}/thirdparty/build_arm64/install/include"',
    ].join(' '),
    'OTHER_LDFLAGS' => '-lc++',
  })

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end
