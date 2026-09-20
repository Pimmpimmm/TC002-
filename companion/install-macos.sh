#!/usr/bin/env bash
# Install the per-user macOS companion: local EMQX + Lark bridge + MQTT adapter.
# This script is intentionally plan-first. It changes nothing without --apply.
set -euo pipefail

LABEL="com.tc002.focus-emqx"
MODE="dry"
LAN_HOST=""
EMQX_HOME=""
PORT="1883"
LOCAL_PORT="1884"
TOPIC="ulanzi/tc002-focus/events/focus"
FOCUS_SECONDS="2700"
REST_SECONDS="300"
CALENDAR_ID=""
APPLY=0

alarm() { printf 'ALARM %s\n' "$*" >&2; exit 2; }

usage() {
  cat <<'USAGE'
用法: companion/install-macos.sh [选项]

  --emqx-home <path>      macOS EMQX 目录；省略时自动寻找 Homebrew EMQX
  --lan-host <ip>         本机局域网 IPv4；时钟通过它连接 EMQX
  --mode dry|fake|real    bridge 模式（默认 dry）
  --calendar-id <id>      real 模式下本人的 Lark 主日历 ID
  --mqtt-topic <topic>    设备事件精确主题
  --focus-seconds <n>     专注时长（默认 2700）
  --rest-seconds <n>      休息时长（默认 300）
  --apply                 真正写入 LaunchAgent 并加载（默认只预演）
  -h, --help              显示帮助

示例：
  companion/install-macos.sh --emqx-home /opt/emqx \
    --lan-host 192.0.2.100 --mode real --calendar-id <id> --apply
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --emqx-home) EMQX_HOME="${2:-}"; shift 2 ;;
    --lan-host) LAN_HOST="${2:-}"; shift 2 ;;
    --mode) MODE="${2:-}"; shift 2 ;;
    --calendar-id) CALENDAR_ID="${2:-}"; shift 2 ;;
    --mqtt-topic) TOPIC="${2:-}"; shift 2 ;;
    --focus-seconds) FOCUS_SECONDS="${2:-}"; shift 2 ;;
    --rest-seconds) REST_SECONDS="${2:-}"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) alarm "未知参数: $1" ;;
  esac
done

[ "$(uname -s)" = "Darwin" ] || alarm "这个安装器只能在 macOS 上运行"
command -v node >/dev/null 2>&1 || alarm "找不到 Node.js 24+"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 24 ] || alarm "当前项目需要 Node.js 24 或更高版本（当前: $(node --version)）"
command -v launchctl >/dev/null 2>&1 || alarm "找不到 launchctl"
if [ -z "$EMQX_HOME" ] && command -v brew >/dev/null 2>&1; then
  EMQX_HOME="$(brew --prefix emqx 2>/dev/null || true)"
fi
[ -n "$EMQX_HOME" ] || alarm "找不到 EMQX，请先运行 brew install emqx，或提供 --emqx-home"
[ -x "$EMQX_HOME/bin/emqx" ] || alarm "EMQX 目录中找不到可执行文件: $EMQX_HOME/bin/emqx"
[ -n "$LAN_HOST" ] || alarm "必须提供 --lan-host，避免自动选错网卡"

case "$MODE" in dry|fake|real) ;; *) alarm "--mode 只能是 dry、fake 或 real" ;; esac
case "$LAN_HOST" in *[!0-9.]*) alarm "--lan-host 必须是 IPv4 地址" ;; esac
case "$PORT" in ''|*[!0-9]*) alarm "内部 MQTT 端口无效" ;; esac
case "$FOCUS_SECONDS" in ''|*[!0-9]*) alarm "--focus-seconds 必须是数字" ;; esac
case "$REST_SECONDS" in ''|*[!0-9]*) alarm "--rest-seconds 必须是数字" ;; esac
[ "$FOCUS_SECONDS" -ge 60 ] && [ "$FOCUS_SECONDS" -le 14400 ] || alarm "--focus-seconds 必须在 60..14400 秒"
[ "$REST_SECONDS" -ge 60 ] && [ "$REST_SECONDS" -le 14400 ] || alarm "--rest-seconds 必须在 60..14400 秒"
case "$TOPIC" in *'#'*|*'+'*|''|*[!A-Za-z0-9_./-]*) alarm "--mqtt-topic 必须是固定 MQTT 主题" ;; esac

REPO="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(command -v node)"
SUPPORT_DIR="$HOME/Library/Application Support/tc002-focus-companion"
LOG_DIR="$HOME/Library/Logs/tc002-focus-companion"
DATA_DIR="$SUPPORT_DIR/emqx-data"
PLIST_DIR="$HOME/Library/LaunchAgents"
EMQX_PLIST="$PLIST_DIR/$LABEL.plist"
TEMPLATE="$REPO/companion/launchagent/$LABEL.plist.template"

case "$MODE" in
  real) ACK="YES" ;;
  *) ACK="NO" ;;
esac

cat <<PLAN
计划（apply=${APPLY}）
  EMQX home        $EMQX_HOME
  EMQX binary      $EMQX_HOME/bin/emqx
  LAN listener     $LAN_HOST:$PORT
  local adapter    mqtt://127.0.0.1:$LOCAL_PORT
  MQTT topic       $TOPIC
  bridge mode      $MODE
  focus seconds    $FOCUS_SECONDS
  rest seconds     $REST_SECONDS
  support dir     $SUPPORT_DIR
  log dir          $LOG_DIR
  EMQX LaunchAgent $EMQX_PLIST
  bridge/mqtt LaunchAgents will be created by bridge/install.sh
  Lark real calls  $([ "$MODE" = real ] && echo enabled || echo disabled)
PLAN

[ "$APPLY" -eq 1 ] || {
  echo
  echo "这是预演，什么都没有写入。确认后加 --apply。"
  exit 0
}

[ -f "$TEMPLATE" ] || alarm "缺少 EMQX plist 模板: $TEMPLATE"
mkdir -p "$SUPPORT_DIR" "$DATA_DIR" "$LOG_DIR" "$PLIST_DIR"
chmod 700 "$SUPPORT_DIR" "$DATA_DIR"

python3 - "$TEMPLATE" "$EMQX_PLIST" "$EMQX_HOME/bin/emqx" "$EMQX_HOME" "$LAN_HOST" "$DATA_DIR" "$LOG_DIR" <<'PY'
import sys
from xml.sax.saxutils import escape

template, target, binary, home, host, data_dir, log_dir = sys.argv[1:]
text = open(template, encoding='utf-8').read()
for key, value in {
    '__EMQX_BIN__': binary,
    '__EMQX_HOME__': home,
    '__LAN_HOST__': host,
    '__DATA_DIR__': data_dir,
    '__LOG_DIR__': log_dir,
}.items():
    text = text.replace(key, escape(value))
open(target, 'w', encoding='utf-8').write(text)
print(f'已写入 {target}')
PY

/usr/bin/plutil -lint "$EMQX_PLIST"

launchctl unload "$EMQX_PLIST" 2>/dev/null || true
launchctl load -w "$EMQX_PLIST"

BRIDGE_ARGS=(
  --mode "$MODE"
  --host 127.0.0.1
  --port 8787
  --focus-seconds "$FOCUS_SECONDS"
  --mqtt-broker "mqtt://127.0.0.1:$LOCAL_PORT"
  --mqtt-topic "$TOPIC"
  --apply
)
[ -n "$CALENDAR_ID" ] && BRIDGE_ARGS+=(--calendar-id "$CALENDAR_ID")
"$REPO/bridge/install.sh" "${BRIDGE_ARGS[@]}"

echo "本机 EMQX、bridge 和 MQTT adapter 已安装并加载。"
echo "日志目录：$LOG_DIR 以及 ~/Library/Logs/tc002-focus-bridge"
echo "时钟应连接到：$LAN_HOST:$PORT"
echo "提醒：要让时钟本身采用这两个时长，请再运行 configure-device.sh 并传入相同的 --focus-seconds / --rest-seconds。"
