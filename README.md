# Ulanzi TC002 专注时钟

这是一个给 Ulanzi TC002 使用的 Focus / Rest 专注时钟，并把当前用户的
Lark 日历忙碌状态同步出去。默认是专注 45 分钟、休息 5 分钟，但每个人
都可以在助手安装/配对时自定义时长。

Lark 忙碌日程现在使用 `visibility=public`：在 Lark 日历共享权限允许的前提下，
同事可以看见这段“专注”日程和时间。它不再是仅自己可见的私密日程。

## 工作方式

每个人的电脑单独运行一套后台助手：

```text
TC002 时钟
   ↓ MQTT
本机 EMQX（每个人自己的电脑）
   ↓
本机 Focus bridge
   ↓
当前用户自己的 Lark 账号
```

电脑助手会在登录后自动启动 EMQX、MQTT adapter 和 Lark bridge。Lark Token、
App Secret 和共享密钥只写入当前用户的 macOS 钥匙串，不写进仓库、设备镜像
或 MQTT 消息。

## 先看这两份说明

- [macOS 助手完整安装步骤](companion/README.md)
- [TC002 设备端说明](device/TC002_Focus_Probe/README_FOCUS.md)
- [交给其他 Agent 执行下载/安装的提示词](AGENT_DOWNLOAD_PROMPT.md)

## 快速安装（每个人的 Mac 都执行一次）

### 1. 安装依赖

```bash
brew install node emqx
node --version     # 需要 24 或更高版本
```

EMQX 的 macOS 安装包由 Homebrew 提供。不要使用 Linux 的
`emqx-*-amzn2023-amd64` 压缩包。

当前 Homebrew 公式页面显示的是 EMQX 5.8.8，并标记 2026-11-30 停止维护；
这份项目先按小规模内网试用配置。长期正式运行前，应评估升级到 EMQX 官方
仍维护的 macOS 版本或使用 Enterprise macOS ZIP。

### 2. 获取代码

```bash
git clone <这个仓库的地址>
cd 时钟
npm install
```

### 3. 登录自己的 Lark

```bash
bash bridge/setup-lark-oauth.sh
```

浏览器授权成功后，Token 会写入本机钥匙串。

### 4. 预演助手安装

先查本机局域网地址，例如：

```bash
ipconfig getifaddr en0
```

再预演（把地址替换成实际值）：

```bash
bash companion/install-macos.sh \
  --lan-host 192.0.2.100 \
  --mode real \
  --calendar-id <本人的主日历ID> \
  --focus-seconds 2700 \
  --rest-seconds 300
```

预演只打印计划，不会安装服务。

### 5. 正式安装

确认预演地址正确后：

```bash
bash companion/install-macos.sh \
  --lan-host 192.0.2.100 \
  --mode real \
  --calendar-id <本人的主日历ID> \
  --focus-seconds 2700 \
  --rest-seconds 300 \
  --apply
```

安装后会自动加载：

- `com.tc002.focus-emqx`
- `com.tc002.focus-bridge`
- `com.tc002.focus-mqtt`

### 6. 配对时钟

确保时钟已经打开 Wi-Fi ADB，然后把电脑地址写入时钟的可写运行目录：

```bash
npm run companion:configure-device -- \
  --adb-target 192.0.2.131:5555 \
  --lan-host 192.0.2.100 \
  --focus-seconds 2700 \
  --rest-seconds 300
```

这里的 `--adb-target` 是时钟地址，`--lan-host` 是电脑地址。这个动作只写
`device.conf`，不改 `/res`，不刷 `update.img`。临时运行在 `/tmp/ui` 时，
追加 `--remote-dir /tmp/ui`。

### 7. 验证

按中键进入 Focus，确认 Lark 出现公开的忙碌日程；提前退出，确认日程
被删除。修改时长后重新运行 `configure-device.sh`，再重启时钟应用，新的
专注/休息时长就会生效。关闭电脑后，时钟本地计时和声音仍应继续工作。

日志目录：

```bash
tail -f "$HOME/Library/Logs/tc002-focus-companion/emqx.log"
tail -f "$HOME/Library/Logs/tc002-focus-bridge/bridge.log"
tail -f "$HOME/Library/Logs/tc002-focus-bridge/mqtt.log"
```

## 暂停电脑助手

```bash
launchctl unload "$HOME/Library/LaunchAgents/com.tc002.focus-emqx.plist"
launchctl unload "$HOME/Library/LaunchAgents/com.tc002.focus-bridge.plist"
launchctl unload "$HOME/Library/LaunchAgents/com.tc002.focus-mqtt.plist"
```

这不会改动时钟固件。当前设备的自动启动入口仍需单独验证，日常使用不要
刷写 `update.img`。

## 当前限制

- 每台电脑一套本机 EMQX，适合人数少、时钟和电脑在同一局域网的场景；
- 电脑关机时，时钟本地功能继续运行，但 Lark 不会即时同步；
- 当前第一版仍使用固定 MQTT 主题，同一台电脑挂多台时钟需要后续增加设备
  序列号配对；
- 正式批量部署前，还应给 EMQX 增加用户名、密码和 ACL。目前版本按可信局域网
  使用，Lark 凭据本身仍受 macOS 钥匙串保护。

## 代码目录

```text
bridge/       Lark OAuth、日历状态机和 MQTT adapter
companion/    macOS 本机 EMQX 与后台服务安装器
device/       TC002 FlyThings 应用与设备端 MQTT 配置读取
probes/       MQTT、Lark 和安全性测试
research/     方案、协议和验证记录
```
