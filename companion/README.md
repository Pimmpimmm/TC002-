# Ulanzi Focus Companion（macOS 第一版）

## 统一 GUI 入口

`../mac-app` 提供了一个原生 macOS 前端。日常使用时，用户只需要在窗口中填写
时钟 IP、本人 Lark 信息和专注/休息时长，然后点击“启动专注时钟”。GUI 会依次
调用本目录的安装器、`configure-device.sh` 和 `start-focus.sh`，不需要用户手动
打开 EMQX 或输入 ADB 命令。

“恢复原生界面”按钮只重启 TC002；临时程序在 `/tmp`，所以设备重启后会恢复原生
页面，不会修改固件。Lark 密钥和 token 仍然只进 macOS 钥匙串。

GUI 将项目目录作为“高级设置（通常无需修改）”保留。`build-app.sh` 会先校验
`device/TC002_Focus_Probe/TemporaryFocusRelease` 的 SHA-256 manifest，再把项目脚本
和设备运行包放进 App Resources。正式对外分发前仍需给 App 签名和公证。

这个目录是每个人电脑上的助手软件安装层。它把三项后台服务一起管理：

1. 本机 EMQX：接收同一局域网内 TC002 发来的 MQTT 事件；
2. Focus bridge：使用 Lark 租户 Token 开启/关闭当前用户的“专注中”系统状态；
3. MQTT adapter：只订阅配置的精确主题，把事件转交给本机 bridge。

Lark 不再创建日历日程；“专注中”由 Personal Settings API 直接设置，并通过 `end_time` 自动到期。

Lark 的 access token、refresh token、App Secret 和共享密钥仍然只写入
macOS 钥匙串，不写入 plist、配置文件或设备。

## 推荐的 EMQX 版本

推荐每台 Mac 使用 Homebrew 安装 EMQX：

```bash
brew update
brew install emqx
"$(brew --prefix emqx)/bin/emqx" foreground
```

看到 EMQX 进入运行状态后按 `Ctrl+C` 停止。后面由助手的 LaunchAgent
负责自动启动它。

Homebrew 当前提供 macOS Apple Silicon 和 Intel 的 EMQX 安装包。这个项目
只使用 MQTT 基础能力，不需要 Enterprise 专属功能。EMQX 官方 macOS 安装
说明见：

- <https://docs.emqx.com/en/emqx/latest/get-started/deploy/install-macOS.html>
- <https://formulae.brew.sh/formula/emqx>

截至 2026-09，Homebrew 公式显示 EMQX 5.8.8，并标记将在 2026-11-30
停止维护。这个版本可用于当前的小规模内网部署；正式长期使用前需要确认
是否升级到 EMQX 官方仍维护的版本。

不要把 Linux 的 `emqx-*-amzn2023-amd64` 压缩包上传给 Mac 用户使用。

## 安装前提

- macOS；
- Node.js 24 或更高版本；
- Homebrew 安装好的 EMQX，或者一份适用于 macOS 的 EMQX 解压目录；
- 电脑和 TC002 在同一个局域网；
- 电脑的局域网 IP 最好在路由器中做 DHCP 保留。

如果从 Finder 启动 GUI，终端的 `.zshrc` 不会自动加载。GUI 会自行查找
Homebrew、`~/.local`、nvm、fnm、Volta 和 mise 中的 Node.js；确实缺少 Node.js、ADB
或 EMQX 时，会在用户确认后使用 Homebrew 安装。

## 从零安装流程

以下步骤每个人的 Mac 都执行一次。
推荐直接在项目根目录双击 `一键准备TC002.command`；下面保留手动步骤用于排查。

### 第 1 步：准备项目和 Node.js

```bash
git clone <你的 GitHub 仓库地址>
cd ulanzi-tc002-focus-clock
npm ci
```

如果电脑没有 Node.js 24 或更高版本，可以使用 Homebrew：

```bash
brew install node
```

### 第 2 步：安装本机 EMQX

```bash
brew install emqx
```

确认路径：

```bash
brew --prefix emqx
```

### 第 3 步：准备 Lark 授权

先完成 Lark OAuth（每个人在自己的 Mac 上做一次）：

```bash
bash bridge/setup-lark-oauth.sh
```

脚本会要求输入 Lark App ID 和 App Secret，并在浏览器打开授权页面。
Token 只会写入本机 macOS 钥匙串。

Lark 自建应用还必须配置回调地址
`http://127.0.0.1:8788/oauth/callback`，开通并发布系统状态的获取、创建、批量开启、批量关闭权限。若返回 `99991672`，先补齐权限并确认应用对当前租户可用。

日常推荐直接使用 GUI 授权。浏览器显示成功后，GUI 会自动关闭本地回调服务；如果旧版 GUI 一直停在“正在打开 Lark 授权页面”，请关闭旧 App 并打开最新构建，钥匙串中的已有凭据无需重新输入。

### 第 4 步：先预演助手安装

把示例中的 `192.0.2.100` 换成这台 Mac 在局域网中的地址。建议在路由器中给它
做 DHCP 保留，避免地址变化。

```bash
bash companion/install-macos.sh \
  --lan-host 192.0.2.100 \
  --mode real \
  --focus-seconds 2700 \
  --rest-seconds 300
```

如果没有使用 Homebrew，而是手动解压了 EMQX，再补上：

```bash
--emqx-home /path/to/emqx
```

### 第 5 步：正式安装助手

确认预演内容正确后，加 `--apply`：

```bash
bash companion/install-macos.sh \
  --lan-host 192.0.2.100 \
  --mode real \
  --focus-seconds 2700 \
  --rest-seconds 300 \
  --apply
```

安装后会创建并加载三个 LaunchAgent：

```text
com.tc002.focus-emqx
com.tc002.focus-bridge
com.tc002.focus-mqtt
```

三者都设置为登录后启动、异常退出自动重启。EMQX 在电脑局域网地址的
`1883` 端口接收时钟，在 `127.0.0.1:1884` 提供给本机 MQTT adapter；
bridge 和 Lark 不对局域网开放。

### 第 6 步：给时钟配对这台电脑

先确认时钟开启了 Wi-Fi ADB，再执行：

```bash
npm run companion:configure-device -- \
  --adb-target 192.0.2.131:5555 \
  --lan-host 192.0.2.100 \
  --focus-seconds 2700 \
  --rest-seconds 300
```

其中 `--adb-target` 是时钟的地址，`--lan-host` 是电脑的地址。这个动作
只写入 `/mnt/extsd/focus-app/device.conf`，不改 `/res`，不制作或刷入
`update.img`。如果当前只是临时运行在 `/tmp/ui`，加上：

```bash
--remote-dir /tmp/ui
```

### 自定义专注/休息时长

时长由助手写入设备的 `device.conf`，不需要重新编译应用。单位是秒，允许
`60..14400` 秒。安装助手时给 bridge 传同一个 `--focus-seconds`；配对时钟
时再把 `--focus-seconds` 和 `--rest-seconds` 传给 `configure-device.sh`：

```bash
npm run companion:configure-device -- \
  --adb-target <时钟IP:5555> \
  --lan-host <电脑局域网IP> \
  --focus-seconds 1500 \
  --rest-seconds 600
```

这表示专注 25 分钟、休息 10 分钟。写完配置后重启时钟应用；电脑助手重新
安装/加载时也要使用相同的 `--focus-seconds`，否则 Lark 的忙碌结束时间和
设备倒计时会不一致。

### 第 7 步：验证

1. 在电脑上确认三个 LaunchAgent 已加载；
2. 重启电脑，确认 EMQX 和助手自动起来；
3. 在时钟上按中键进入 Focus；
4. 检查本人的 Lark 是否出现“专注中”系统状态；
5. 提前退出，检查状态是否关闭；
6. 关闭电脑，确认时钟仍能本地倒计时和播放声音。

查看日志：

```bash
tail -f "$HOME/Library/Logs/tc002-focus-companion/emqx.log"
tail -f "$HOME/Library/Logs/tc002-focus-bridge/bridge.log"
tail -f "$HOME/Library/Logs/tc002-focus-bridge/mqtt.log"
```

## 当前边界和恢复

第一版仍沿用设备当前的固定 MQTT 主题。因为每个人运行的是独立的本机
EMQX，所以不同电脑之间不会串消息。以后同一台电脑要挂多台时钟时，再把
设备序列号加入 topic 和配对界面。

电脑关机时，时钟自己的倒计时和声音不受影响；只是 Lark 同步会等电脑和
助手重新上线后恢复。

如果要暂时停掉电脑助手：

```bash
launchctl unload "$HOME/Library/LaunchAgents/com.tc002.focus-emqx.plist"
launchctl unload "$HOME/Library/LaunchAgents/com.tc002.focus-bridge.plist"
launchctl unload "$HOME/Library/LaunchAgents/com.tc002.focus-mqtt.plist"
```

这不会刷写或删除时钟固件。当前方案的设备自动启动入口仍需要单独验证，
不要把 `update.img` 当成日常安装步骤。
