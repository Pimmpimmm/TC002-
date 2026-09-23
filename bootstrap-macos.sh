#!/usr/bin/env bash
# Prepare a new Mac, verify the checked-out release, build the GUI, and open it.
set -euo pipefail

APPLY=0
for ARG in "$@"; do
  case "$ARG" in
    --apply) APPLY=1 ;;
    -h|--help)
      printf '用法: bash bootstrap-macos.sh [--apply]\n默认只预演；--apply 会安装 Homebrew 依赖、验证代码、构建并打开 App。\n'
      exit 0
      ;;
    *) printf 'ALARM 未知参数: %s\n' "$ARG" >&2; exit 2 ;;
  esac
done

alarm() { printf 'ALARM %s\n' "$*" >&2; exit 2; }
official_help() {
  local url="$1"
  printf '官方下载安装页：%s\n' "$url" >&2
  if command -v open >/dev/null 2>&1; then
    if open "$url" >/dev/null 2>&1; then
      printf '已在浏览器打开。安装完成后，重新运行 bash bootstrap-macos.sh --apply。\n' >&2
    else
      printf '无法自动打开浏览器，请复制上面的地址。\n' >&2
    fi
  fi
}
[ "$(uname -s)" = "Darwin" ] || alarm "只支持 macOS"
ROOT="$(cd "$(dirname "$0")" && pwd)"
if ! command -v brew >/dev/null 2>&1; then
  official_help "https://brew.sh"
  alarm "请先安装 Homebrew"
fi
if ! xcode-select -p >/dev/null 2>&1; then
  official_help "https://developer.apple.com/download/all/"
  alarm "请先运行 xcode-select --install 安装 Apple 命令行工具"
fi

NEEDS_NODE=0
if ! command -v node >/dev/null 2>&1; then
  NEEDS_NODE=1
else
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$NODE_MAJOR" -ge 24 ] || NEEDS_NODE=1
fi
command -v adb >/dev/null 2>&1 && ADB_STATUS="ready" || ADB_STATUS="install android-platform-tools"
EMQX_HOME="$(brew --prefix emqx 2>/dev/null || true)"
[ -n "$EMQX_HOME" ] && EMQX_STATUS="ready ($EMQX_HOME)" || EMQX_STATUS="install emqx"
[ "$NEEDS_NODE" -eq 0 ] && NODE_STATUS="ready ($(node --version))" || NODE_STATUS="install/upgrade Node.js 24+"

cat <<PLAN
新 Mac 部署计划（apply=${APPLY}）
  Node.js   ${NODE_STATUS}
  ADB       ${ADB_STATUS}
  EMQX      ${EMQX_STATUS}
  project   ${ROOT}
  checks    npm ci + automated tests + runtime bundle checksum + macOS App build
  services  完成 Lark 授权并在 App 点击“启动专注时钟”后创建
PLAN

[ "$APPLY" -eq 1 ] || {
  printf '\n这是预演，什么都没有修改。确认后运行: bash bootstrap-macos.sh --apply\n'
  exit 0
}

if [ "$NEEDS_NODE" -eq 1 ]; then
  if brew list --versions node >/dev/null 2>&1; then
    brew upgrade node || { official_help "https://nodejs.org/en/download"; alarm "Node.js 升级失败"; }
  else
    brew install node || { official_help "https://nodejs.org/en/download"; alarm "Node.js 安装失败"; }
  fi
fi
[ "$ADB_STATUS" = "ready" ] || brew install --cask android-platform-tools || {
  official_help "https://developer.android.com/tools/releases/platform-tools"
  alarm "ADB 安装失败"
}
[ -n "$EMQX_HOME" ] || brew install emqx || {
  official_help "https://www.emqx.com/en/downloads-and-install/broker"
  alarm "EMQX 安装失败"
}

cd "$ROOT"
npm ci
npm test
bash companion/verify-runtime-bundle.sh
bash mac-app/build-app.sh
open "$ROOT/mac-app/dist/TC002FocusCompanion.app"
printf '\n环境与 App 已准备完成。此时显示“待首次启动”是正常的。\n'
printf '请在 App 内完成 Lark 授权、填写时钟 IP，再点击“启动专注时钟”；随后三个后台助手才会安装并运行。\n'
