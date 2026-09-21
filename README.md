# Ulanzi TC002 专注时钟

这是一个给 Ulanzi TC002 使用的 Focus / Rest 专注时钟，并把当前用户的
Lark“专注中”系统状态同步出去。默认是专注 45 分钟、休息 5 分钟，但每个人
都可以在助手安装/配对时自定义时长。

运行时直接调用 Lark Personal Settings API，不再创建或删除日历日程。

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

- [macOS 统一 GUI 入口](mac-app/README.md)
- [macOS 助手完整安装步骤](companion/README.md)
- [TC002 设备端说明](device/TC002_Focus_Probe/README_FOCUS.md)
- [交给其他 Agent 执行下载/安装的提示词](AGENT_DOWNLOAD_PROMPT.md)

## 给 AI Agent 的一键配置提示词

在新 Mac 上，可以把下面这段直接发给支持执行终端命令的 AI Agent。它会先下载
最新代码、预演环境检查，再安装依赖、构建并打开 GUI；Lark OAuth 和 TC002 的
Wi-Fi ADB 配对仍由用户本人确认，凭据不会写入仓库：

```text
请把 https://github.com/Pimmpimmm/TC002-.git 部署到这台 macOS 电脑：先检查
macOS 13+、Homebrew 和 Apple Command Line Tools，克隆仓库并阅读 README.md。
运行 `bash bootstrap-macos.sh` 做预演，确认后运行
`bash bootstrap-macos.sh --apply`。不要刷写 update.img、不要修改 /res、不要
把 Lark Secret/Token 写入文件或发到聊天里。打开生成的 TC002FocusCompanion.app，
让我在 GUI 中输入 TC002 的 Wi-Fi ADB 地址和自己的 Lark App 信息，并在浏览器
完成 OAuth；然后点击“启动专注时钟”。最后运行测试和 bundle 校验，确认 EMQX、
Lark bridge、MQTT adapter、ADB 和 Lark 系统状态都正常，并只报告结果和仍需我
手动完成的步骤。完整流程和 GUI 不可用时的 CLI 备用命令见
`AGENT_DOWNLOAD_PROMPT.md`。
```

完整、可复制的 Agent 流程（含权限、网络、错误码和安全边界）见
[AGENT_DOWNLOAD_PROMPT.md](AGENT_DOWNLOAD_PROMPT.md)。

## 新 Mac 推荐入口

先安装 [Homebrew](https://brew.sh) 和 Apple 命令行工具（`xcode-select --install`），
然后克隆仓库，在 Finder 中双击 `一键准备TC002.command`，或运行：

```bash
bash bootstrap-macos.sh --apply
```

该入口会安装/升级 Node.js、EMQX 和 ADB，执行自动测试与发布包校验，
构建并打开 TC002 Focus Companion。用户只需在 App 内完成 Lark 授权、
填写设备 IP 并点击“启动专注时钟”。Lark 授权必须由用户本人在浏览器确认。

当前安全部署模式为临时部署：不刷固件，TC002 重启后恢复原生界面。
新设备需要先在设备上开启 Wi-Fi ADB。

首次使用前，还要在 Lark 开放平台的自建应用中配置 OAuth 回调地址
`http://127.0.0.1:8788/oauth/callback`，开通系统状态相关 API 权限（获取、创建、批量开启、批量关闭），并发布应用版本、确认当前租户可用。GUI 会在授权后自动复用或创建“专注中”状态，不需要创建日历。

## 手动安装（排查时使用）

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
npm ci
```

### 3. 登录自己的 Lark

```bash
bash bridge/setup-lark-oauth.sh
```

浏览器授权成功后，Token 会写入本机钥匙串。

如果回调页面显示 `Authorization failed`，先查看 GUI 日志或终端错误码：

- `99991672` 表示应用还没有申请对应的 API 权限；开通并发布系统状态权限后重新授权；
- 浏览器已经显示成功、但 GUI 仍停在“正在打开 Lark 授权页面”时，关闭旧版 App，重新打开最新构建。新版会主动关闭浏览器 keep-alive 连接并完成收尾；
- Finder 启动 App 时不会读取终端 `.zshrc`。GUI 会自动识别 Homebrew、`~/.local`、nvm、fnm、Volta 和 mise 中的 Node.js。

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

按中键进入 Focus，确认 Lark 出现“专注中”系统状态；提前退出，确认状态
被关闭。修改时长后重新运行 `configure-device.sh`，再重启时钟应用，新的
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
bridge/       Lark OAuth、系统状态机和 MQTT adapter
companion/    macOS 本机 EMQX 与后台服务安装器
device/       TC002 FlyThings 应用与设备端 MQTT 配置读取
probes/       MQTT、Lark 和安全性测试
research/     方案、协议和验证记录
```
