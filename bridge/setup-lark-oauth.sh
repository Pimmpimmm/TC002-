#!/usr/bin/env bash
set -euo pipefail

SERVICE="tc002-focus-bridge"
alarm() { printf 'ALARM %s\n' "$*" >&2; exit 2; }
[ "$(uname -s)" = "Darwin" ] || alarm "本脚本只能在 macOS 本机终端运行"
[ -x /usr/bin/security ] || alarm "找不到 macOS Keychain 工具"
NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || alarm "找不到 Node.js"
REPO="$(cd "$(dirname "$0")/.." && pwd)"

printf '粘贴 Lark App ID（输入不会写入 shell 历史）: '
IFS= read -r APP_ID
printf '粘贴 Lark App Secret（输入不回显）: '
IFS= read -r -s APP_SECRET
printf '\n'
[ -n "$APP_ID" ] || alarm "App ID 为空"
[ "${#APP_SECRET}" -ge 8 ] || alarm "App Secret 太短"

/usr/bin/security add-generic-password -U -s "$SERVICE" -a app_id -w "$APP_ID" >/dev/null
/usr/bin/security add-generic-password -U -s "$SERVICE" -a app_secret -w "$APP_SECRET" >/dev/null
unset APP_ID APP_SECRET

exec "$NODE_BIN" "$REPO/bridge/oauth.mjs"
