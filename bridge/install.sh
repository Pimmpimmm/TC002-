#!/usr/bin/env bash
# First-time setup for the TC002 focus bridge (research/SPEC-V2-45-5.md §8 / S1).
# Writes the shared secret and calendar id into the macOS Keychain and
# installs a LaunchAgent. Prints its plan and changes NOTHING unless --apply is given.
set -euo pipefail

SERVICE="tc002-focus-bridge"
LABEL="com.tc002.focus-bridge"
MQTT_LABEL="com.tc002.focus-mqtt"
MODE="dry"
HOST="127.0.0.1"
PORT="8787"
FOCUS_SECONDS="2700"
CALENDAR_ID=""
MQTT_BROKER="mqtt://127.0.0.1:1883"
MQTT_TOPIC="ulanzi/tc002-focus/events/focus"
APPLY=0

alarm() { printf 'ALARM %s\n' "$*" >&2; exit 2; }

usage() {
  cat <<'USAGE'
用法: bridge/install.sh [选项]

  --apply                 真正写入 Keychain 并安装 LaunchAgent（默认只打印计划）
  --mode dry|fake|real    dry=完全不碰网络（默认）；real=会真的改 Lark 日历
  --host <ip>             监听地址；先用 127.0.0.1 自测，联调时改成本机局域网 IP
  --port <port>           监听端口（默认 8787）
  --focus-seconds <n>     专注秒数（默认 2700）
  --calendar-id <id>      Lark 主日历 ID；首次 --apply 时必填（之后从 Keychain 读）
  --mqtt-broker <url>     本机 EMQX 地址（默认 mqtt://127.0.0.1:1883）
  --mqtt-topic <topic>    时钟事件专用主题（默认 ulanzi/tc002-focus/events/focus）
  -h, --help              显示本说明

real 模式直接使用 setup-lark-oauth.sh 写入钥匙串的 OAuth 凭据，并自动续期。
fake 模式的测试 token 仍通过隐藏输入读取，不会进 shell 历史。
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --mode) MODE="${2:-}"; shift 2 ;;
    --host) HOST="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --focus-seconds) FOCUS_SECONDS="${2:-}"; shift 2 ;;
    --calendar-id) CALENDAR_ID="${2:-}"; shift 2 ;;
    --mqtt-broker) MQTT_BROKER="${2:-}"; shift 2 ;;
    --mqtt-topic) MQTT_TOPIC="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) alarm "未知参数: $1" ;;
  esac
done

case "$MODE" in dry|fake|real) ;; *) alarm "--mode 只能是 dry、fake 或 real" ;; esac
case "$PORT" in ''|*[!0-9]*) alarm "--port 必须是数字" ;; esac
case "$FOCUS_SECONDS" in ''|*[!0-9]*) alarm "--focus-seconds 必须是数字" ;; esac
[ "$(uname -s)" = "Darwin" ] || alarm "本脚本只能在 macOS 本机终端运行（当前: $(uname -s)）"
case "$MQTT_BROKER" in mqtt://127.0.0.1:*|mqtt://localhost:*) ;; *) alarm "--mqtt-broker 只允许本机 EMQX 地址" ;; esac
case "$MQTT_TOPIC" in *'#'*|*'+'*|''|*[!A-Za-z0-9_./-]*) alarm "--mqtt-topic 必须是无通配符的固定主题" ;; esac
[ -x /usr/bin/security ] || alarm "找不到 /usr/bin/security"
command -v launchctl >/dev/null 2>&1 || alarm "找不到 launchctl"
NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || alarm "找不到 node，请先安装 Node.js 24 以上"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SUPPORT_DIR="$HOME/Library/Application Support/$SERVICE"
STATE_FILE="$SUPPORT_DIR/state.json"
LOG_DIR="$HOME/Library/Logs/$SERVICE"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
MQTT_PLIST="$HOME/Library/LaunchAgents/$MQTT_LABEL.plist"
TEMPLATE="$REPO/bridge/launchagent/$LABEL.plist.template"
MQTT_TEMPLATE="$REPO/bridge/launchagent/$MQTT_LABEL.plist.template"
[ -f "$TEMPLATE" ] || alarm "缺少 plist 模板: $TEMPLATE"
[ -f "$MQTT_TEMPLATE" ] || alarm "缺少 plist 模板: $MQTT_TEMPLATE"

keychain_has() { /usr/bin/security find-generic-password -s "$SERVICE" -a "$1" -w >/dev/null 2>&1; }
keychain_set() { /usr/bin/security add-generic-password -U -s "$SERVICE" -a "$1" -w "$2"; }

SECRET_STATUS="reuse existing keychain item"
keychain_has shared_secret || SECRET_STATUS="generate a new 32-byte secret"

if [ -z "$CALENDAR_ID" ] && ! keychain_has calendar_id; then
  CALENDAR_STATUS="MISSING —— 首次 --apply 必须带 --calendar-id"
elif [ -n "$CALENDAR_ID" ]; then
  CALENDAR_STATUS="write the id given on the command line"
else
  CALENDAR_STATUS="reuse existing keychain item"
fi

TOKEN_STATUS="not needed in dry mode"
[ "$MODE" = "fake" ] && TOKEN_STATUS="prompt for test user_access_token (hidden input)"
[ "$MODE" = "real" ] && TOKEN_STATUS="reuse OAuth credentials from Keychain with automatic refresh"
ACK_VALUE="NO"
[ "$MODE" = "real" ] && ACK_VALUE="YES"

cat <<PLAN
计划（apply=${APPLY}）
  repo             $REPO
  node             $NODE_BIN
  mode             $MODE   (real 才会真的改 Lark；dry 完全不碰网络)
  listen           $HOST:$PORT
  focus seconds    $FOCUS_SECONDS
  state file       $STATE_FILE
  log dir          $LOG_DIR
  launch agent     $PLIST  (label $LABEL)
  mqtt agent       $MQTT_PLIST  (label $MQTT_LABEL)
  mqtt broker      $MQTT_BROKER
  mqtt topic       $MQTT_TOPIC
  keychain service $SERVICE
    shared_secret      $SECRET_STATUS
    calendar_id        $CALENDAR_STATUS
    user_access_token  $TOKEN_STATUS
  plist 里不写任何密钥，只写 BRIDGE_ACK_REAL_LARK=$ACK_VALUE
PLAN

if [ "$APPLY" -eq 0 ]; then
  echo
  echo "这是预演，什么都没写。确认无误后加 --apply 重跑。"
  exit 0
fi

case "$CALENDAR_STATUS" in MISSING*) alarm "首次安装必须提供 --calendar-id" ;; esac

if [ "$MODE" = "real" ]; then
  for ACCOUNT in app_id app_secret user_access_token refresh_token access_token_expires_at; do
    keychain_has "$ACCOUNT" || alarm "钥匙串缺少 $ACCOUNT，请先运行 bridge/setup-lark-oauth.sh"
  done
fi

if ! keychain_has shared_secret; then
  NEW_SECRET="$(/usr/bin/openssl rand -hex 32)"
  keychain_set shared_secret "$NEW_SECRET"
  echo "已生成并写入 shared_secret（32 字节 hex）。设备端要用同一个值，稍后用下面的命令取："
  echo "  security find-generic-password -s $SERVICE -a shared_secret -w"
  unset NEW_SECRET
fi
[ -n "$CALENDAR_ID" ] && keychain_set calendar_id "$CALENDAR_ID"

if [ "$MODE" = "fake" ]; then
  printf '粘贴 user_access_token（不回显，回车结束）: '
  IFS= read -r -s LARK_TOKEN
  printf '\n'
  [ -n "$LARK_TOKEN" ] || alarm "token 为空"
  keychain_set user_access_token "$LARK_TOKEN"
  unset LARK_TOKEN
fi

mkdir -p "$SUPPORT_DIR" "$LOG_DIR" "$HOME/Library/LaunchAgents"
chmod 700 "$SUPPORT_DIR"

python3 - "$TEMPLATE" "$PLIST" "$NODE_BIN" "$REPO" "$MODE" "$HOST" "$PORT" "$FOCUS_SECONDS" "$STATE_FILE" "$LOG_DIR" "$ACK_VALUE" <<'PY'
import sys
from xml.sax.saxutils import escape
template, target, node, repo, mode, host, port, focus, state_file, log_dir, ack = sys.argv[1:12]
text = open(template, encoding='utf-8').read()
for key, value in {
    '__NODE__': node, '__REPO__': repo, '__MODE__': mode, '__HOST__': host, '__PORT__': port,
    '__FOCUS_SECONDS__': focus, '__STATE_FILE__': state_file, '__LOG_DIR__': log_dir, '__ACK_VALUE__': ack
}.items():
    text = text.replace(key, escape(value))
open(target, 'w', encoding='utf-8').write(text)
print(f'已写入 {target}')
PY

python3 - "$MQTT_TEMPLATE" "$MQTT_PLIST" "$NODE_BIN" "$REPO" "$LOG_DIR" "$MQTT_BROKER" "$MQTT_TOPIC" <<'PY'
import sys
from xml.sax.saxutils import escape
template, target, node, repo, log_dir, broker, topic = sys.argv[1:8]
text = open(template, encoding='utf-8').read()
for key, value in {
    '__NODE__': node, '__REPO__': repo, '__LOG_DIR__': log_dir,
    '__MQTT_BROKER__': broker, '__MQTT_TOPIC__': topic
}.items():
    text = text.replace(key, escape(value))
open(target, 'w', encoding='utf-8').write(text)
print(f'已写入 {target}')
PY

/usr/bin/plutil -lint "$PLIST"
/usr/bin/plutil -lint "$MQTT_PLIST"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"
launchctl unload "$MQTT_PLIST" 2>/dev/null || true
launchctl load -w "$MQTT_PLIST"
echo "两个 LaunchAgent 已加载。日志目录: $LOG_DIR"
