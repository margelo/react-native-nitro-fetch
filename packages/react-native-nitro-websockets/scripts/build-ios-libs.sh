#!/usr/bin/env bash
# build-ios-libs.sh
#
# Rebuilds libwebsockets + mbedTLS for iOS and outputs pre-built XCFrameworks
# to thirdparty/xcframeworks/ and lws_config.h to thirdparty/lws_config.h.
#
# Run this after upgrading libwebsockets or mbedTLS, then commit the results:
#   bash scripts/build-ios-libs.sh
#   git add thirdparty/xcframeworks thirdparty/lws_config.h
#   git commit -m "chore: update pre-built iOS xcframeworks"
#
# Prerequisites: cmake, xcodebuild, python3, git submodules initialised
#   git submodule update --init --recursive

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/../thirdparty"
XCFW="$ROOT/xcframeworks"

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

  mkdir -p "$DEST/install/lib"
  find "$DEST/lws" -name "libwebsockets.a" | head -1 | xargs -I{} cp {} "$DEST/install/lib/"
}

# Remove stale xcframeworks so they're fully rebuilt.
rm -rf "$XCFW"

# Run all three arch builds in parallel — each writes to its own DEST dir.
build_for_arch arm64  iphoneos        &
build_for_arch x86_64 iphonesimulator &
build_for_arch arm64  iphonesimulator arm64_sim &
wait

# Copy lws_config.h to the stable tracked location, stripping machine-specific
# absolute paths from LWS_INSTALL_DATADIR / LWS_INSTALL_LIBDIR (used only by
# lws test apps, which we disable; safe to leave empty).
sed \
  -e 's|#define LWS_INSTALL_DATADIR ".*"|#define LWS_INSTALL_DATADIR ""|' \
  -e 's|#define LWS_INSTALL_LIBDIR ".*"|#define LWS_INSTALL_LIBDIR ""|' \
  "$ROOT/build_arm64/lws/lws_config.h" > "$ROOT/lws_config.h"

# Create fat simulator lib (x86_64 + arm64 simulator slices).
SIM_FAT="$ROOT/build_sim_fat/lib"
mkdir -p "$SIM_FAT"
for LIB in libwebsockets libmbedtls libmbedx509 libmbedcrypto; do
  lipo -create \
    "$ROOT/build_x86_64/install/lib/${LIB}.a" \
    "$ROOT/build_arm64_sim/install/lib/${LIB}.a" \
    -output "$SIM_FAT/${LIB}.a"
done

# Wrap into XCFrameworks.
mkdir -p "$XCFW"
for LIB in libwebsockets libmbedtls libmbedx509 libmbedcrypto; do
  xcodebuild -create-xcframework \
    -library "$ROOT/build_arm64/install/lib/${LIB}.a" \
    -library "$SIM_FAT/${LIB}.a" \
    -output "$XCFW/${LIB}.xcframework"
done

echo ""
echo "=== Build complete ==="
echo "Commit the results:"
echo "  git add thirdparty/xcframeworks thirdparty/lws_config.h"
echo "  git commit -m 'chore: update pre-built iOS xcframeworks'"
