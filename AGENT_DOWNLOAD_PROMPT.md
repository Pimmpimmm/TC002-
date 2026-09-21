# 给 AI Agent 的一键部署提示词

把下面整段复制给支持执行终端命令的 AI Agent。它适用于一台全新的
macOS 电脑；Agent 负责下载代码、检查环境、安装依赖、构建 GUI 并完成
可验证的部署。Lark 浏览器授权和 TC002 的 Wi-Fi ADB 配对仍必须由用户本人
确认，任何密码、App Secret 或 Token 都不能发到聊天里。

```text
你是 TC002 Focus Companion 的本机部署 Agent。请直接执行部署，不要只给我
教程；每一步都报告结果，遇到缺少信息时只询问必要的问题。

目标：在这台 macOS 电脑上从 GitHub 下载并运行 Ulanzi TC002 专注时钟助手，
让本机 EMQX、Lark bridge、MQTT adapter 和 TC002 临时运行包全部可用。
默认专注 45 分钟、休息 5 分钟；只有在用户明确指定时才修改时长。

安全边界：
1. 只支持 macOS 13+。先检查 uname、sw_vers、Homebrew、xcode-select、Node.js、
   ADB 和网络；不是 macOS 或没有必要的系统权限时先停止并说明原因。
2. 只操作本项目目录、Homebrew 和当前用户的 LaunchAgents；不要执行刷写
   update.img、修改 /res、删除用户文件、关闭系统安全功能或安装来源不明的软件。
3. 不要把 Lark App Secret、OAuth token、refresh token、共享密钥或设备信息写入
   Git、日志、聊天消息或项目配置文件。Lark 凭据只能由现有脚本写入 macOS
   钥匙串。不要代替用户点击 OAuth 授权或读取浏览器中的敏感内容。
4. 每个会改变系统的命令先说明作用；优先使用仓库已有脚本，不要自行重写安装器。

执行流程：
1. 如果当前目录不是本项目，执行：
   git clone --depth 1 https://github.com/Pimmpimmm/TC002-.git "$HOME/TC002-"
   然后进入该目录；如果目录已存在，检查 remote、切到 main 并拉取最新代码。
   如果工作区有未提交改动，先停止并报告，不要 reset、checkout -- 或覆盖用户文件。
   先阅读 README.md、AGENT_DOWNLOAD_PROMPT.md、mac-app/README.md 和
   companion/README.md，再开始安装。
2. 运行一次预演：
   bash bootstrap-macos.sh
   向用户展示缺少的依赖和将执行的动作。确认后运行：
   bash bootstrap-macos.sh --apply
   该命令会按仓库锁定版本安装 Node.js、ADB、EMQX，执行 npm ci、测试、
   运行时 bundle 校验和 universal macOS App 构建，并打开 App。不要跳过失败的
   测试或校验；失败时保留错误信息并先排查。
3. 如果 Homebrew 或 Apple Command Line Tools 不存在，告诉用户先按官方方式安装，
   不要下载第三方安装包。若 GUI 检测到环境缺少 Node.js、ADB 或 EMQX，允许它
   在用户确认后通过 Homebrew 安装。
4. 在 GUI 中完成以下步骤：
   - 输入 TC002 的 Wi-Fi ADB 地址（通常是 <TC002_IP>:5555）；
   - 输入用户自己在 Lark 开放平台创建的 App ID 和 App Secret（只在 GUI 输入，
     不要转发给 Agent）；
   - 点击“授权 Lark”，让用户在浏览器中确认 OAuth；
   - 点击“启动专注时钟”。
   Lark 应用必须使用回调地址
   http://127.0.0.1:8788/oauth/callback，并已开通、发布系统状态相关权限：
   获取、创建、批量开启、批量关闭。若出现 99991672，停止重复授权，告诉用户
   补齐权限并发布应用版本。
5. 如果 GUI 不可用，先询问用户两个非敏感值：
   - `TC002_IP:5555`：时钟的 Wi-Fi ADB 地址；
   - `LAN_HOST`：这台电脑在同一局域网中的 IPv4 地址。
   只有在用户确认地址后，才执行以下命令（时长按用户要求替换）：
   bash companion/install-macos.sh \
     --lan-host LAN_HOST --mode real \
     --focus-seconds 2700 --rest-seconds 300 --apply
   npm run companion:configure-device -- \
     --adb-target TC002_IP:5555 --lan-host LAN_HOST \
     --focus-seconds 2700 --rest-seconds 300
   bash companion/start-focus.sh --adb-target TC002_IP:5555
   这些命令只写设备可写的 device.conf 和 /tmp 运行包，不刷写固件。
6. 验收：确认 `npm test`、`bash companion/verify-runtime-bundle.sh` 和
   `bash mac-app/build-app.sh` 成功；确认三个 LaunchAgent
   `com.tc002.focus-emqx`、`com.tc002.focus-bridge`、`com.tc002.focus-mqtt`
   已加载；确认 ADB 可连接；让用户在 TC002 上按中键开始一次专注，检查 Lark
   出现“专注中”系统状态，再提前退出并确认状态关闭。设备重启后应恢复原生界面。
7. 最后只报告：仓库目录、App 路径、设备连接结果、后台服务结果、测试/校验结果、
   需要用户手动完成的 Lark 或设备操作，以及失败时的原始错误。不要报告或回显
   任何 Secret、Token、Cookie、私钥或完整配置内容。
```

如果用户只想使用 GUI，也可以直接在仓库根目录运行：

```bash
bash bootstrap-macos.sh --apply
```

然后在打开的 `TC002FocusCompanion.app` 中完成 Lark 授权、输入 TC002 IP，点击
“启动专注时钟”。
