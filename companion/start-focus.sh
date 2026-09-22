#!/usr/bin/env bash
# Push the temporary TC002 focus bundle and restart only the userspace UI.
# This never writes /res, update.img, or any firmware partition.
set -euo pipefail

ADB_TARGET=""
BUNDLE=""
AUDIO=""

alarm() { printf 'ALARM %s\n' "$*" >&2; exit 2; }

usage() {
  cat <<'USAGE'
用法: companion/start-focus.sh --adb-target <ip:5555> [--bundle <目录>] [--audio <file.mp3>]

默认 bundle：device/TC002_Focus_Probe/TemporaryFocusRelease
只写入 /tmp/ui、/tmp/lib 和 /tmp/EasyUI.cfg，重启 zkswe 后临时生效。
设备断电或重启后会回到原生界面。
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --adb-target) ADB_TARGET="${2:-}"; shift 2 ;;
    --bundle) BUNDLE="${2:-}"; shift 2 ;;
    --audio) AUDIO="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) alarm "未知参数: $1" ;;
  esac
done

command -v adb >/dev/null 2>&1 || alarm "找不到 adb"
[ -n "$ADB_TARGET" ] || alarm "必须提供 --adb-target"
case "$ADB_TARGET" in *:*) ;; *) ADB_TARGET="$ADB_TARGET:5555" ;; esac
case "$ADB_TARGET" in *[!0-9.:]*) alarm "--adb-target 必须是 IPv4[:port]" ;; esac
REPO="$(cd "$(dirname "$0")/.." && pwd)"
[ -n "$BUNDLE" ] || BUNDLE="$REPO/device/TC002_Focus_Probe/TemporaryFocusRelease"
bash "$REPO/companion/verify-runtime-bundle.sh" "$BUNDLE" >/dev/null

if [ -n "$AUDIO" ]; then
  [ -f "$AUDIO" ] || alarm "找不到自定义提示音：$AUDIO"
  case "${AUDIO##*.}" in
    mp3|MP3|Mp3|mP3) ;;
    *) alarm "自定义提示音必须是 MP3 文件" ;;
  esac
  AUDIO_BYTES="$(wc -c < "$AUDIO" | tr -d '[:space:]')"
  [ "$AUDIO_BYTES" -gt 0 ] && [ "$AUDIO_BYTES" -le 20971520 ] || alarm "自定义提示音必须大于 0 且不超过 20 MB"
fi

CONNECT_OUTPUT="$(adb connect "$ADB_TARGET" 2>&1 || true)"
case "$CONNECT_OUTPUT" in
  *connected*|*already*) ;;
  *) alarm "ADB 无法连接 $ADB_TARGET: $CONNECT_OUTPUT" ;;
esac
[ "$(adb -s "$ADB_TARGET" get-state 2>/dev/null || true)" = "device" ] || alarm "ADB 设备未就绪: $ADB_TARGET"
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

if [ -n "$AUDIO" ]; then
  adb -s "$ADB_TARGET" push "$AUDIO" /tmp/ui/audio/focus_done.mp3 >/dev/null
  printf '已使用自定义提示音：%s\n' "$(basename "$AUDIO")"
fi

adb -s "$ADB_TARGET" shell 'setprop ctl.restart zkswe'
printf '已临时启动 TC002 专注界面。设备重启后恢复原生界面。\n'
