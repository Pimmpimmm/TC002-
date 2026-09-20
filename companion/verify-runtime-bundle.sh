#!/usr/bin/env bash
set -euo pipefail

alarm() { printf 'ALARM %s\n' "$*" >&2; exit 2; }

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="${1:-$REPO/device/TC002_Focus_Probe/TemporaryFocusRelease}"

[ -d "$BUNDLE" ] || alarm "找不到设备运行 bundle: $BUNDLE"
for REQUIRED in \
  EasyUI.cfg \
  MANIFEST.sha256 \
  lib/libzkgui.so \
  ui/main.ftu \
  ui/btnTest.ftu \
  ui/audio/focus_done.mp3; do
  [ -f "$BUNDLE/$REQUIRED" ] || alarm "bundle 缺少 $REQUIRED"
done

grep -q '"resPath":"/tmp/ui/"' "$BUNDLE/EasyUI.cfg" || alarm "EasyUI.cfg 不是 /tmp 临时部署配置"
grep -q '"startupLibPath":"/tmp/lib/libzkgui.so"' "$BUNDLE/EasyUI.cfg" || alarm "EasyUI.cfg 的启动库路径错误"
command -v shasum >/dev/null 2>&1 || alarm "找不到 shasum"
(
  cd "$BUNDLE"
  shasum -a 256 -c MANIFEST.sha256
)
printf '设备运行 bundle 校验通过：%s\n' "$BUNDLE"
