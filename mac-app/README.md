# Ulanzi TC002 Focus Companion（macOS GUI）

这是统一入口的原生 macOS 前端。界面按“准备电脑 → 连接 TC002 → 授权 Lark → 专注设置”四步引导：

1. 检查 Node.js、ADB、EMQX 和设备运行包；
2. 填写时钟 IP，自动识别电脑 IP，并可单独测试 ADB 连接；
3. 填写 Lark App ID 和 App Secret，完成授权后可单独验证系统状态权限；
4. 设置专注/休息分钟数，点击“启动专注时钟”；
5. 应用自动安装/启动本机 EMQX、Lark bridge、MQTT adapter，写入设备时长，
   并把临时 Focus bundle 推到 `/tmp`；
6. 点击“恢复原生界面”会重启时钟。重启只清掉临时程序，不刷写固件。

界面会显示环境、Lark、TC002 和后台服务的独立就绪状态。OAuth 输出会实时出现在日志区，启动时会按 1/4–4/4 显示当前进度。

当前界面采用原生 macOS 卡片式布局，支持浅色和深色模式。顶部集中展示产品状态和 TC002 点阵预览，四个就绪状态均同时提供图标、文字和语义色。专注与休息时长限制为 1–240 分钟；“启动专注时钟”是主要操作，停止助手和恢复原生界面保持为次要操作。

环境检查会识别 Homebrew、`~/.local`、nvm、fnm、Volta 和 mise 等常见 Node.js 安装位置，不依赖 Finder 是否加载终端的 `.zshrc`。如果确实缺少 Node.js、ADB 或 EMQX，界面会说明缺少的组件，并在用户确认后使用 Homebrew 安装。

Lark 自建应用需要先配置回调地址
`http://127.0.0.1:8788/oauth/callback`，并开通、发布系统状态相关 API 权限：获取系统状态、创建系统状态、批量开启和批量关闭。授权按钮会打开浏览器，OAuth 输出会实时显示在日志区；浏览器回调完成后，GUI 会自动关闭本地授权服务并恢复按钮。

Lark App Secret、OAuth token、refresh token 和 bridge shared secret 不写入 GUI
配置文件，仍由现有 bridge 写入 macOS 钥匙串。GUI 配置文件只保存设备 IP、时长、
项目目录。用户 `open_id` 和“专注中”状态 ID 在授权时自动获取。

## 新 Mac 准备

仓库根目录提供 `一键准备TC002.command`。它会安装 Homebrew 中缺少的
Node.js、EMQX 和 ADB，执行测试和 bundle 完整性校验，然后构建并打开 App。
Homebrew 和 Apple Command Line Tools 仍需要用户先安装。

## 运行前提

- macOS 13 或更高版本；
- Node.js 24+、Homebrew EMQX、ADB 已安装；
- 时钟已经打开 Wi‑Fi ADB，且和 Mac 在同一个局域网；
- bootstrap 会用 `npm ci` 安装本项目锁定的依赖；
- 首次使用需要在 Lark 开放平台配置 OAuth 回调：
  `http://127.0.0.1:8788/oauth/callback`。

## 授权和环境排障

- Lark 返回 `HTTP 400, code 99991672`：应用缺少系统状态 API 权限。开通权限、发布应用版本并确认租户可用后，再点击“重新授权 Lark”。
- 浏览器显示授权成功但 GUI 一直显示“正在打开 Lark 授权页面”：这是旧版本地 OAuth 服务没有关闭浏览器 keep-alive 连接。请退出并重新打开最新的 App；凭据已经写入钥匙串，不需要重复填写 Secret。
- GUI 报 Node.js 缺失但终端可以运行：Finder 不加载 `.zshrc`。新版 GUI 会扫描 Homebrew、`~/.local`、nvm、fnm、Volta 和 mise；仍缺少时会询问是否使用 Homebrew 安装。
- 本地 OAuth 端口被占用时，先关闭其他一次性授权窗口，再重新授权；端口为 `127.0.0.1:8788`。

项目根目录运行（开发调试）：

```bash
cd mac-app
swift run
```

生成可双击的 `.app`：

```bash
bash mac-app/build-app.sh
open mac-app/dist/TC002FocusCompanion.app
```

当前构建会把 bridge、companion 和已校验的 `TemporaryFocusRelease` 放入
App Resources。Node 由 bootstrap 在用户电脑安装。正式对外分发前仍需签名和公证。

## 安全边界

- “启动”只临时写 `/tmp/ui`、`/tmp/lib`、`/tmp/EasyUI.cfg` 和设备可写目录中的
  `device.conf`；不写 `/res`，不生成或刷入 `update.img`。
- “恢复原生界面”本质是重启 TC002；设备重启后自然回到原生界面。
- 每个人的 Lark 凭据保存在自己的 Mac 钥匙串，不放在 GitHub 或共享配置文件中。
