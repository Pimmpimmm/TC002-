#!/usr/bin/env bash
set -euo pipefail

# FlyThings' official Z21 compiler is an x86_64 Linux program. Run this script
# inside an x86_64 Linux VM/container and mount the three directories below.
PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "$0")" && pwd)}"
TOOLCHAIN_ROOT="${TOOLCHAIN_ROOT:-/toolchain}"
PACKAGES_ROOT="${PACKAGES_ROOT:-/packages}"
BUILD_DIR="${BUILD_DIR:-$PROJECT_DIR/TemporaryFocusRelease}"
DEPLOY_DIR="${DEPLOY_DIR:-/tmp}"
ONLY_SOURCE="${ONLY_SOURCE:-}"

if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo "This builder needs x86_64 Linux; current host is $(uname -s)/$(uname -m)." >&2
  exit 2
fi

CXX="$TOOLCHAIN_ROOT/bin/arm-linux-gnueabihf-g++"
if [[ ! -x "$CXX" ]]; then
  echo "Official compiler not found: $CXX" >&2
  exit 2
fi

package_dir() {
  local name="$1"
  local revision="$2"
  local path="$PACKAGES_ROOT/$name-$revision/content"
  if [[ ! -d "$path" ]]; then
    echo "FlyThings package missing: $path" >&2
    exit 2
  fi
  printf '%s' "$path"
}

EASYUI="$(package_dir easyui 2.6.0)"
LOG="$(package_dir log 0.0.0)"
ZKHARDWARE="$(package_dir zkhardware 0.0.0)"
ZKNET="$(package_dir zknet 0.0.0)"
BASE="$(package_dir base-utility 10.9.3)"
EXT4="$(package_dir ext4 0.0.1)"
TRANSFER="$(package_dir transfer-protocols 3.0.0)"
AUDIO="$(package_dir audio-utility 5.1.1)"
BASEJSON="$(package_dir base-json 3.0.3)"
FFMPEG="$(package_dir ffmpeg 4.1.9)"
MIAO="$(package_dir mi_ao 0.0.0)"
MICOMMON="$(package_dir mi_common 0.0.0)"
MISYS="$(package_dir mi_sys 0.0.0)"
CAMOS="$(package_dir cam_os_wrapper 0.0.0)"
APC="$(package_dir apc 0.0.0)"
AEC="$(package_dir aec 0.0.0)"
ZLIB="$(package_dir z 1.2.11)"

INCLUDES=(
  "-I$PROJECT_DIR/src"
  "-I$EASYUI/include"
  "-I$LOG/include"
  "-I$ZKHARDWARE/include"
  "-I$ZKNET/include"
  "-I$BASE/include"
  "-I$EXT4/include"
  "-I$TRANSFER/include"
  "-I$AUDIO/include"
)

SOURCES=(
  src/Main.cpp
  src/activity/mainActivity.cpp
  src/activity/btnTestActivity.cpp
  src/focus/FocusController.cpp
  src/focus/MqttPublisher.cpp
  src/managers/KeyManager.cpp
  src/managers/AudioManager.cpp
  src/managers/McuManager.cpp
  src/managers/PageManager.cpp
  src/mcuProtocol/mcuProtoParse.cpp
  src/pages/FocusPage.cpp
  src/pages/PageBase.cpp
  src/pages/WorldTimePage.cpp
  src/uart/ProtocolParser.cpp
  src/uart/ProtocolSender.cpp
  src/uart/UartContext.cpp
  src/utils/EventContext.cpp
  src/utils/Painter.cpp
  src/utils/Surface.cpp
)

case "$BUILD_DIR" in
  ""|"/"|"$PROJECT_DIR")
    echo "Unsafe BUILD_DIR: $BUILD_DIR" >&2
    exit 2
    ;;
esac
rm -rf "$BUILD_DIR/obj" "$BUILD_DIR/lib" "$BUILD_DIR/ui"
rm -f "$BUILD_DIR/EasyUI.cfg" "$BUILD_DIR/MANIFEST.sha256"
mkdir -p "$BUILD_DIR/obj" "$BUILD_DIR/lib" "$BUILD_DIR/ui/audio"

OBJECTS=()
for source in "${SOURCES[@]}"; do
  object_name="${source//\//_}"
  object="$BUILD_DIR/obj/${object_name%.*}.o"
  if [[ -n "$ONLY_SOURCE" && "$source" != "$ONLY_SOURCE" ]]; then
    if [[ ! -f "$object" ]]; then
      echo "Cannot reuse missing object for $source: $object" >&2
      exit 2
    fi
    echo "REUSE $source"
    OBJECTS+=("$object")
    continue
  fi
  echo "CXX $source"
  "$CXX" \
    -O3 -fPIC -pipe -Wformat -Werror=format-security \
    -fstack-protector -fno-caller-saves -fexceptions -std=c++11 \
    -D__PLATFORM_Z21__=1 '-DLOG_TAG="zkgui"' \
    -MMD -MP "${INCLUDES[@]}" \
    -c "$PROJECT_DIR/$source" -o "$object"
  OBJECTS+=("$object")
done

echo "LINK libzkgui.so"
"$CXX" -shared -s \
  -Wl,-z,now -Wl,-z,relro -Wl,-z,defs \
  -Wl,--warn-common -Wl,-z,combreloc -Wl,--warn-once \
  -o "$BUILD_DIR/lib/libzkgui.so" \
  "${OBJECTS[@]}" \
  -L"$EASYUI/lib" -L"$LOG/lib" -L"$ZKHARDWARE/lib" -L"$ZKNET/lib" \
  -L"$BASE/lib" -L"$EXT4/lib" -L"$TRANSFER/lib" \
  -L"$AUDIO/lib" -L"$BASEJSON/lib" -L"$FFMPEG/lib" \
  -L"$MIAO/lib" -L"$MICOMMON/lib" -L"$MISYS/lib" -L"$CAMOS/lib" \
  -L"$APC/lib" -L"$AEC/lib" \
  -L"$ZLIB/lib" \
  -leasyui -lzkhardware -lzknet -llog \
  -Wl,--start-group -ltransfer-protocols -laudio-utility -lbase-json \
  -lbase-utility -lext4 -lavformat -lavcodec -lavutil -lswresample \
  -lswscale -lavfilter -lavdevice -lmi_ao -lmi_common -lmi_sys \
  -lcam_os_wrapper -lAPC_LINUX -lAEC_LINUX -lz -Wl,--end-group \
  -pthread -ldl -lrt -lm

cp "$PROJECT_DIR/ui/main.ftu" "$PROJECT_DIR/ui/btnTest.ftu" "$BUILD_DIR/ui/"
cp "$PROJECT_DIR/ui/audio/focus_done.mp3" "$BUILD_DIR/ui/audio/"
cp "$EASYUI/lib/libeasyui.so" "$LOG/lib/liblog.so" \
  "$ZKHARDWARE/lib/libzkhardware.so" "$ZKNET/lib/libzknet.so" \
  "$BUILD_DIR/lib/"
cp "$MIAO/lib/libmi_ao.so" "$MICOMMON/lib/libmi_common.so" \
  "$MISYS/lib/libmi_sys.so" "$CAMOS/lib/libcam_os_wrapper.so" \
  "$APC/lib/libAPC_LINUX.so" "$AEC/lib/libAEC_LINUX.so" \
  "$BUILD_DIR/lib/"

printf '%s\n' "{\"baud\":\"115200\",\"defBrightness\":-1,\"languageCode\":\"zh_CN\",\"languagePath\":\"$DEPLOY_DIR/tr/\",\"resPath\":\"$DEPLOY_DIR/ui/\",\"rotateScreen\":0,\"rotateTouch\":0,\"screensaverTimeOut\":-1,\"startupLibPath\":\"$DEPLOY_DIR/lib/libzkgui.so\",\"startupTouchCalib\":false,\"touchDev\":\"/dev/input/event0\",\"uart\":\"ttyS1\",\"zkdebug\":false}" > "$BUILD_DIR/EasyUI.cfg"

(
  cd "$BUILD_DIR"
  find EasyUI.cfg lib ui -type f -print0 | sort -z | xargs -0 sha256sum > MANIFEST.sha256
)

echo "Built: $BUILD_DIR/lib/libzkgui.so"
echo "Debug bundle: $BUILD_DIR"
