# TC002 焦点桥接（Mac 侧）

如果要给每个人安装一套本机 EMQX 和后台助手，请优先看
`../companion/README.md`。本文件保留 bridge 的协议和单独调试说明。

权威需求与状态机见 `../research/SPEC-V2-45-5.md`。桥接只做三件事：**验证来源、每个 `session_id` 只维护一条 Lark 日程、过了 45 分钟边界就再也不碰 Lark**。它不决定任何时间——开始与结束都由时钟设备说了算。

## 快速自测（不碰网络、不碰 Lark）

```bash
export BRIDGE_SHARED_SECRET=$(openssl rand -hex 32)
export LARK_CALENDAR_ID=primary-test BRIDGE_LARK_MODE=dry BRIDGE_PORT=8791
node bridge/server.mjs &
node bridge/send-test-event.mjs --event start --session sess-smoke001 --port 8791 --print-recipe
node bridge/send-test-event.mjs --event stop  --session sess-smoke001 --port 8791 --reason rotate_away
```

## 通过 EMQX 接收时钟事件

桥接服务本身仍只监听本机 HTTP；`mqtt-adapter.mjs` 连接 EMQX、只订阅一个精确 topic，然后将消息原样签名转发给本机桥接：

```bash
export MQTT_BROKER=mqtt://<EMQX地址>:1883
export MQTT_EVENT_TOPIC=tc002/<自定义设备名>/events/focus
npm run bridge:mqtt
```

- 当前只支持局域网 `mqtt://`，不把用户名/密码写入 URL 或日志。
- Topic 必须是完整精确值，不允许 `#` / `+` 通配。
- MQTT 消息上限 4 KB，必须是 UTF-8 JSON；适配器不修改正文。
- 运行顺序：先启动 `npm run bridge`，再启动 `npm run bridge:mqtt`。

`dry` 模式零网络请求；`--print-recipe` 打印的就是设备端要实现的签名算法。

## 三种模式

| 模式 | 网络 | 用途 |
|---|---|---|
| `dry`（默认） | 完全不发请求 | 联调设备 → Mac 的链路 |
| `fake` | 只允许 `http://127.0.0.1`（`BRIDGE_LARK_BASE`） | 用 `bridge/fake-lark.mjs` 测断线、重试、重复事件 |
| `real` | `https://open.larksuite.com` | 真的改日历；**必须** `BRIDGE_ACK_REAL_LARK=YES` |

## 安装

首先用本机 OAuth 授权 Lark。App ID、App Secret、access token 和 refresh token 都只进 macOS Keychain：

```bash
bridge/setup-lark-oauth.sh
```

将脚本打印的链接在浏览器打开并授权。回调地址固定为 `http://127.0.0.1:8788/oauth/callback`。授权链接明确申请日历读取、创建、删除和 `offline_access`；桥接在 access token 过期前自动用 refresh token 轮换，不需要定期手工粘贴 token。

授权成功后，让工具读取并安全保存当前用户的主日历编号：

```bash
npm run bridge:calendar
```

```bash
bridge/install.sh --mode dry --calendar-id <你的主日历 id>          # 预演，什么都不写
bridge/install.sh --mode dry --calendar-id <你的主日历 id> --apply  # 写 Keychain + 装 LaunchAgent
```

安装脚本同时安装 MQTT 接收服务。默认连接本机 EMQX
`mqtt://127.0.0.1:1883`，只订阅 `ulanzi/tc002-focus/events/focus`；网络断开时进程退出，由 macOS 自动重启并重连。

只能在 macOS 本机终端运行（会检查 `uname`）。Keychain 服务名 `tc002-focus-bridge`，三个条目：

- `shared_secret`：首次安装自动生成 32 字节，**设备端要烧同一个值**，取值：`security find-generic-password -s tc002-focus-bridge -a shared_secret -w`
- `calendar_id`：Lark 主日历 ID
- `user_access_token`：OAuth 自动写入并续期；real 模式安装时不再手工输入

plist 里不写任何密钥；状态在 `~/Library/Application Support/tc002-focus-bridge/state.json`，日志在 `~/Library/Logs/tc002-focus-bridge/`。

## 设备要发什么

`POST /focus`，头部 `X-TC002-Timestamp` + `X-TC002-Signature`（±120 秒窗口），体：

```json
{"v":1,"session_id":"sess-xxxxxxxx","event":"start","state":"FOCUS","reason":"middle_press","started_at":1789111934,"focus_deadline":1789114634}
```

- `event`：`start` | `stop` | `heartbeat`；`reason`：`middle_press` | `rotate_away` | `user_exit` | `focus_ack` | `boot_recovery`
- `focus_deadline - started_at` 必须**精确等于** `FOCUS_SECONDS`，否则 400
- 出现 `sender`、`content` 这类字段或任何未列出的字段 → 直接 400（隐私硬规则）
- 请求体上限 4 KB；只服务 `POST /focus`

## 关键行为（都有单测）

- 同一 `session_id` 重复 `start` → 不新建、不延长 deadline
- 提前退出（中键或旋钮）→ DELETE 那条日程；失败则指数退避重试到 45 分钟边界为止
- **到了 `focus_deadline` 之后：对 Lark 零调用**，日程靠 `end_time` 自行解除
- Lark 离线时 `start` 后马上 `stop` → 队列里的 create 被抵消，一个请求都不发
- 心跳报非 FOCUS 状态 → 对账删除；重启只恢复绝对 deadline，绝不重算 45 分钟

`npm test` 覆盖以上全部（含回环假 Lark 的故障注入）。
