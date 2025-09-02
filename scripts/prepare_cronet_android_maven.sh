#!/usr/bin/env bash
set -euo pipefail

# Download prebuilt Cronet from Maven Central and extract native libs.
# Optionally fetch Cronet C headers from Chromium source for the specified version.
# This avoids a full Chromium checkout.
#
# Usage:
#   scripts/prepare_cronet_android_maven.sh --version 122.0.6261.69 --abis arm64-v8a,armeabi-v7a
#
# Notes:
# - This script downloads from Maven Central; ensure you have network access.
# - Headers are fetched from Chromium's source tree for convenience. Verify license/compatibility as needed.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=""
ABIS="arm64-v8a"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="$2"; shift 2 ;;
    --abis)
      ABIS="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  echo "--version is required (e.g., 122.0.6261.69)" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Downloading cronet-embedded AAR $VERSION ..."
CRONET_AAR_URL="https://repo1.maven.org/maven2/org/chromium/net/cronet-embedded/$VERSION/cronet-embedded-$VERSION.aar"
curl -fL "$CRONET_AAR_URL" -o "$TMP_DIR/cronet-embedded.aar"

echo "Extracting native libraries..."
unzip -q -o "$TMP_DIR/cronet-embedded.aar" -d "$TMP_DIR/aar"

DEST_LIBS_DIR="$ROOT_DIR/android/cronet/libs"
mkdir -p "$DEST_LIBS_DIR"
IFS=',' read -r -a ABI_ARR <<< "$ABIS"
for ABI in "${ABI_ARR[@]}"; do
  mkdir -p "$DEST_LIBS_DIR/$ABI"
  if [[ -d "$TMP_DIR/aar/jni/$ABI" ]]; then
    cp "$TMP_DIR/aar/jni/$ABI"/*.so "$DEST_LIBS_DIR/$ABI/"
    echo "Copied libs for $ABI"
  else
    echo "Warning: ABI $ABI not found in AAR"
  fi
done

echo "Fetching Cronet C headers (cronet_c.h) for version $VERSION ..."
DEST_INCLUDE="$ROOT_DIR/android/cronet/include/cronet"
mkdir -p "$DEST_INCLUDE"

# Best-effort: Use Chromium source at tag corresponding to major version.
MAJOR="${VERSION%%.*}"
# Try refs for Chromium tags where Cronet lives under components/cronet/native
BASE_RAW="https://raw.githubusercontent.com/chromium/chromium"
PATH_C_H="components/cronet/native/cronet_c.h"
PATH_EXPORT_H="components/cronet/native/cronet_export.h"

for REF in "$VERSION" "$MAJOR" "main"; do
  URL1="$BASE_RAW/$REF/$PATH_C_H"
  URL2="$BASE_RAW/$REF/$PATH_EXPORT_H"
  if curl -fsL "$URL1" -o "$DEST_INCLUDE/cronet_c.h"; then
    echo "Downloaded cronet_c.h from $REF"
    curl -fsL "$URL2" -o "$DEST_INCLUDE/cronet_export.h" || true
    break
  fi
done

if [[ ! -f "$DEST_INCLUDE/cronet_c.h" ]]; then
  echo "Warning: Failed to fetch cronet_c.h automatically. Please place headers under android/cronet/include/cronet/"
fi

echo "Done. Headers in android/cronet/include (cronet/...), libs in android/cronet/libs/<abi>."

