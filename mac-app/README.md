# TC002 专注助手（macOS GUI）

这是统一入口的原生 macOS 前端。它把原来需要分别执行的动作收进一个窗口：

1. 填写时钟 IP、电脑 IP、专注/休息分钟数；
2. 填写本人的 Lark App ID、App Secret 和日历 ID，点击“授权 Lark”；
3. 点击“启动专注时钟”；
4. 应用自动安装/启动本机 EMQX、Lark bridge、MQTT adapter，写入设备时长，
   并把临时 Focus bundle 推到 `/tmp`；
5. 点击“恢复原生界面”会重启时钟。重启只清掉临时程序，不刷写固件。

Lark App Secret、OAuth token、refresh token 和 bridge shared secret 不写入 GUI
配置文件，仍由现有 bridge 写入 macOS 钥匙串。GUI 配置文件只保存设备 IP、时长、
日历 ID 和项目目录。

## 当前原型的运行前提

- macOS 13 或更高版本；
- Node.js 24+、Homebrew EMQX、ADB 已安装；
- 时钟已经打开 Wi‑Fi ADB，且和 Mac 在同一个局域网；
- 先用 `npm install` 安装本项目依赖；
- 首次使用需要在 Lark 开放平台配置 OAuth 回调：
  `http://127.0.0.1:8788/oauth/callback`。

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

目前 GUI 是可工作的开发版；正式给其他人分发时，下一步应把本项目的 bridge、
companion、`TemporaryFocusRelease` 和 Node 运行时放入 App Resources，再做签名和
公证。这样普通用户就不需要看到“项目目录”这个高级字段，也不需要手动安装命令行工具。

## 安全边界

- “启动”只临时写 `/tmp/ui`、`/tmp/lib`、`/tmp/EasyUI.cfg` 和设备可写目录中的
  `device.conf`；不写 `/res`，不生成或刷入 `update.img`。
- “恢复原生界面”本质是重启 TC002；设备重启后自然回到原生界面。
- 每个人的 Lark 凭据保存在自己的 Mac 钥匙串，不放在 GitHub 或共享配置文件中。
