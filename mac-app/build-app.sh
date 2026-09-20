#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT/mac-app/dist/TC002FocusCompanion.app"
BUILD_DIR="$(mktemp -d /tmp/tc002-focus-swift.XXXXXX)"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
SWIFTC="$(xcrun --find swiftc)"

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources/tc002-repo/device/TC002_Focus_Probe"
for ARCH in arm64 x86_64; do
  mkdir -p "$BUILD_DIR/$ARCH-module-cache" "$BUILD_DIR/$ARCH-clang-cache"
  SWIFT_MODULECACHE_PATH="$BUILD_DIR/$ARCH-module-cache" "$SWIFTC" \
    -parse-as-library \
    -Xcc -fmodules-cache-path="$BUILD_DIR/$ARCH-clang-cache" \
    -sdk "$SDK" -target "$ARCH-apple-macosx13.0" \
    -framework AppKit \
    "$ROOT/mac-app/Sources/TC002FocusCompanion.swift" \
    -o "$BUILD_DIR/TC002FocusCompanion-$ARCH"
done
lipo -create "$BUILD_DIR/TC002FocusCompanion-arm64" "$BUILD_DIR/TC002FocusCompanion-x86_64" \
  -output "$APP_DIR/Contents/MacOS/TC002FocusCompanion"

cp "$ROOT/mac-app/Info.plist" "$APP_DIR/Contents/Info.plist"
cp -R "$ROOT/bridge" "$ROOT/companion" "$ROOT/probes" "$APP_DIR/Contents/Resources/tc002-repo/"
cp -R "$ROOT/device/TC002_Focus_Probe/TemporaryFocusRelease" "$APP_DIR/Contents/Resources/tc002-repo/device/TC002_Focus_Probe/"
chmod +x "$APP_DIR/Contents/MacOS/TC002FocusCompanion"
printf '已生成 %s\n' "$APP_DIR"
