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
  # It cmake-builds static archives for device (arm64) and
  # simulator (arm64 + x86_64) and lipo's them together.
  s.prepare_command = <<-CMD
    set -e
    ROOT="$(pwd)/thirdparty"

    build_for_arch() {
      local ARCH="$1" SDK="$2" DEST="$ROOT/build_${ARCH}"

      echo "=== Building mbedTLS for $ARCH ($SDK) ==="
      cmake -S "$ROOT/mbedtls" -B "$DEST/mbedtls" \
        -DCMAKE_OSX_ARCHITECTURES="$ARCH" \
        -DCMAKE_OSX_SYSROOT="$(xcrun --sdk $SDK --show-sdk-path)" \
        -DCMAKE_INSTALL_PREFIX="$DEST/install" \
        -DCMAKE_BUILD_TYPE=Release \
        -DENABLE_TESTING=OFF \
        -DENABLE_PROGRAMS=OFF \
        -DUSE_SHARED_MBEDTLS_LIBRARY=OFF \
        -DUSE_STATIC_MBEDTLS_LIBRARY=ON \
        -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
        -Wno-dev -G Xcode 2>/dev/null || \
      cmake -S "$ROOT/mbedtls" -B "$DEST/mbedtls" \
        -DCMAKE_OSX_ARCHITECTURES="$ARCH" \
        -DCMAKE_OSX_SYSROOT="$(xcrun --sdk $SDK --show-sdk-path)" \
        -DCMAKE_INSTALL_PREFIX="$DEST/install" \
        -DCMAKE_BUILD_TYPE=Release \
        -DENABLE_TESTING=OFF \
        -DENABLE_PROGRAMS=OFF \
        -DUSE_SHARED_MBEDTLS_LIBRARY=OFF \
        -DUSE_STATIC_MBEDTLS_LIBRARY=ON \
        -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
        -Wno-dev
      cmake --build "$DEST/mbedtls" --config Release --target install -- -j4

      echo "=== Building libwebsockets for $ARCH ($SDK) ==="
      cmake -S "$ROOT/libwebsockets" -B "$DEST/lws" \
        -DCMAKE_OSX_ARCHITECTURES="$ARCH" \
        -DCMAKE_OSX_SYSROOT="$(xcrun --sdk $SDK --show-sdk-path)" \
        -DCMAKE_INSTALL_PREFIX="$DEST/install" \
        -DCMAKE_BUILD_TYPE=Release \
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
        -Wno-dev
      cmake --build "$DEST/lws" --config Release --target websockets_static -- -j4
    }

    # Device: arm64
    if [ ! -f "$ROOT/build_arm64/lws/lib/libwebsockets.a" ]; then
      build_for_arch arm64 iphoneos
    fi

    # Simulator: x86_64 (fat binary with arm64 sim added below)
    if [ ! -f "$ROOT/build_x86_64/lws/lib/libwebsockets.a" ]; then
      build_for_arch x86_64 iphonesimulator
    fi

    # Simulator arm64
    if [ ! -f "$ROOT/build_arm64_sim/lws/lib/libwebsockets.a" ]; then
      build_for_arch arm64 iphonesimulator
    fi

    # Create fat simulator libs (arm64 + x86_64)
    SIM_DEST="$ROOT/build_sim_fat"
    mkdir -p "$SIM_DEST/lib"
    for LIB in libwebsockets libmbedtls libmbedx509 libmbedcrypto; do
      DEVICE_LIB="$ROOT/build_arm64/install/lib/${LIB}.a"
      X64_LIB="$ROOT/build_x86_64/install/lib/${LIB}.a"
      ARM64_SIM_LIB="$ROOT/build_arm64_sim/install/lib/${LIB}.a"
      if [ -f "$DEVICE_LIB" ] && [ -f "$X64_LIB" ]; then
        if [ -f "$ARM64_SIM_LIB" ]; then
          lipo -create "$X64_LIB" "$ARM64_SIM_LIB" -output "$SIM_DEST/lib/${LIB}.a"
        else
          cp "$X64_LIB" "$SIM_DEST/lib/${LIB}.a"
        fi
      fi
    done

    echo "=== libwebsockets iOS build complete ==="
  CMD

  s.vendored_libraries = [
    "thirdparty/build_arm64/install/lib/libwebsockets.a",
    "thirdparty/build_arm64/install/lib/libmbedtls.a",
    "thirdparty/build_arm64/install/lib/libmbedx509.a",
    "thirdparty/build_arm64/install/lib/libmbedcrypto.a",
  ]

  load 'nitrogen/generated/ios/NitroFetchWebsockets+autolinking.rb'
  add_nitrogen_files(s)

  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => [
      '"${PODS_TARGET_SRCROOT}/thirdparty/libwebsockets/include"',
      '"${PODS_TARGET_SRCROOT}/thirdparty/build_arm64/lws"',
    ].join(' '),
    'OTHER_LDFLAGS'       => '-lc++',
    'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'arm64',
  }

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end
