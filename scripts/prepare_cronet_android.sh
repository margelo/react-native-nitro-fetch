#!/usr/bin/env bash
set -euo pipefail

# Prepare Chromium Cronet C API build and copy headers/libs into this repo.
#
# Requirements:
# - macOS/Linux host with Python 3, git, Java (for Android tools), Ninja, and Android NDK if building for Android.
# - Sufficient disk space (>30GB) for Chromium checkout.
#
# Usage examples:
#   scripts/prepare_cronet_android.sh --checkout /path/to/chromium --arch arm64-v8a
#   scripts/prepare_cronet_android.sh --checkout /path/to/chromium --arch armeabi-v7a
#
# Notes:
# - By default builds Android arm64. Use --arch to change.
# - This script will not modify your PATH permanently; it prepends depot_tools for this run.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHROMIUM_DIR=""
ARCH="arm64-v8a"  # map to target_cpu

while [[ $# -gt 0 ]]; do
  case "$1" in
    --checkout)
      CHROMIUM_DIR="$2"; shift 2 ;;
    --arch)
      ARCH="$2"; shift 2 ;;
    *)
      echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$CHROMIUM_DIR" ]]; then
  echo "--checkout <path> is required (Chromium source root)" >&2
  exit 1
fi

mkdir -p "$CHROMIUM_DIR"
cd "$CHROMIUM_DIR"

# 1) depot_tools
if [[ ! -d depot_tools ]]; then
  echo "Cloning depot_tools..."
  git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
fi
export PATH="$CHROMIUM_DIR/depot_tools:$PATH"

# 2) Fetch chromium src
if [[ ! -d src ]]; then
  echo "Fetching chromium (this may take a while)..."
  fetch --nohooks chromium
fi
cd src

echo "Running gclient runhooks..."
gclient runhooks

# 3) Configure GN args
TARGET_CPU="arm64"
case "$ARCH" in
  arm64-v8a) TARGET_CPU="arm64" ;;
  armeabi-v7a) TARGET_CPU="arm" ;;
  x86_64) TARGET_CPU="x64" ;;
  x86) TARGET_CPU="x86" ;;
  *) echo "Unsupported --arch: $ARCH" >&2; exit 1 ;;
esac

OUT_DIR="out/cronet_$TARGET_CPU"
ARGS=(
  target_os=\"android\"
  target_cpu=\"$TARGET_CPU\"
  is_debug=false
  is_component_build=false
  symbol_level=0
)

echo "Generating GN files for $TARGET_CPU..."
gn gen "$OUT_DIR" --args="${ARGS[*]}"

echo "Building cronet_package..."
autoninja -C "$OUT_DIR" cronet_package

# 4) Find and extract cronet package artifacts
PKG_DIR="$OUT_DIR/cronet"
ZIP_CANDIDATE=$(ls "$OUT_DIR"/cronet_*.zip 2>/dev/null | head -n1 || true)

if [[ -d "$PKG_DIR" ]]; then
  echo "Found cronet package directory: $PKG_DIR"
elif [[ -n "$ZIP_CANDIDATE" ]]; then
  echo "Unzipping $ZIP_CANDIDATE..."
  unzip -q -o "$ZIP_CANDIDATE" -d "$OUT_DIR"
  PKG_DIR="$OUT_DIR/cronet"
else
  echo "Could not find cronet package output in $OUT_DIR" >&2
  exit 1
fi

if [[ ! -d "$PKG_DIR/include" ]]; then
  echo "Cronet package missing include/ in $PKG_DIR" >&2
  exit 1
fi

# 5) Copy headers + libs into the RN repo under android/cronet
DEST_DIR="$ROOT_DIR/android/cronet"
mkdir -p "$DEST_DIR"

echo "Copying headers to $DEST_DIR/include ..."
rm -rf "$DEST_DIR/include"
cp -R "$PKG_DIR/include" "$DEST_DIR/"

echo "Copying libraries for $ARCH ..."
mkdir -p "$DEST_DIR/libs/$ARCH"
# Typical locations under the package
if ls "$PKG_DIR/libs/$ARCH"/*.so >/dev/null 2>&1; then
  cp "$PKG_DIR/libs/$ARCH"/*.so "$DEST_DIR/libs/$ARCH/"
else
  # Fallback: search any .so files
  find "$PKG_DIR" -name "*.so" -exec cp {} "$DEST_DIR/libs/$ARCH/" \;
fi

echo "Cronet prepared under $DEST_DIR"
echo "CMake will auto-detect headers and libs when building the Android library."

