#!/usr/bin/env bash
# Push the temporary TC002 focus bundle and restart only the userspace UI.
# This never writes /res, update.img, or any firmware partition.
set -euo pipefail

ADB_TARGET=""
BUNDLE=""

alarm() { printf 'ALARM %s\n' "$*" >&2; exit 2; }

usage() {
  cat <<'USAGE'
用法: companion/start-focus.sh --adb-target <ip:5555> [--bundle <目录>]

默认 bundle：device/TC002_Focus_Probe/TemporaryFocusRelease
只写入 /tmp/ui、/tmp/lib 和 /tmp/EasyUI.cfg，重启 zkswe 后临时生效。
设备断电或重启后会回到原生界面。
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --adb-target) ADB_TARGET="${2:-}"; shift 2 ;;
    --bundle) BUNDLE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) alarm "未知参数: $1" ;;
  esac
done

command -v adb >/dev/null 2>&1 || alarm "找不到 adb"
[ -n "$ADB_TARGET" ] || alarm "必须提供 --adb-target"
case "$ADB_TARGET" in *:*) ;; *) ADB_TARGET="$ADB_TARGET:5555" ;; esac
REPO="$(cd "$(dirname "$0")/.." && pwd)"
[ -n "$BUNDLE" ] || BUNDLE="$REPO/device/TC002_Focus_Probe/TemporaryFocusRelease"
[ -f "$BUNDLE/EasyUI.cfg" ] || alarm "找不到临时 bundle: $BUNDLE/EasyUI.cfg"
[ -f "$BUNDLE/lib/libzkgui.so" ] || alarm "bundle 缺少 lib/libzkgui.so"

adb connect "$ADB_TARGET" >/dev/null 2>&1 || true
adb -s "$ADB_TARGET" wait-for-device
adb -s "$ADB_TARGET" shell 'mkdir -p /tmp/ui/audio /tmp/lib /tmp/tr'
adb -s "$ADB_TARGET" push "$BUNDLE/EasyUI.cfg" /tmp/EasyUI.cfg >/dev/null

for library in "$BUNDLE"/lib/*.so; do
  [ -f "$library" ] || continue
  adb -s "$ADB_TARGET" push "$library" /tmp/lib/ >/dev/null
done

for resource in "$BUNDLE"/ui/*.ftu; do
  [ -f "$resource" ] || continue
  adb -s "$ADB_TARGET" push "$resource" /tmp/ui/ >/dev/null
done

for audio in "$BUNDLE"/ui/audio/*; do
  [ -f "$audio" ] || continue
  adb -s "$ADB_TARGET" push "$audio" /tmp/ui/audio/ >/dev/null
done

adb -s "$ADB_TARGET" shell 'setprop ctl.restart zkswe'
printf '已临时启动 TC002 专注界面。设备重启后恢复原生界面。\n'
