# TC002 专注桥接（Mac 侧）

桥接只做三件事：验证时钟事件、按 `session_id` 幂等开启 Lark“专注中”系统状态、提前退出时关闭状态。状态带 `end_time`，因此 Mac 断网或程序退出也不会让状态永久卡住。

## 一次授权

在 Lark 开放平台的自建应用中配置回调地址 `http://127.0.0.1:8788/oauth/callback`，开通并发布系统状态相关 API 权限（获取、创建、批量开启、批量关闭），确认应用在当前租户可用，然后运行：

```bash
bash bridge/setup-lark-oauth.sh
```

授权流程会自动：

- 把 App ID、App Secret 和 OAuth token 存入 macOS Keychain，不写入仓库；
- 调用 `/authen/v1/user_info` 获取当前用户 `open_id`；
- 列出租户系统状态，复用已有的“专注中”，没有时只创建一次；
- 保存 `user_open_id` 和 `system_status_id`。

GUI 用户不需要运行上面的终端脚本；在 App 中点击“授权 Lark”即可。终端脚本适合无 GUI 或排查场景。授权回调成功后，本地 HTTP 服务会主动关闭浏览器 keep-alive 连接并退出。

如果收到 `HTTP 400, code 99991672`，表示应用尚未申请对应 API 权限；请在开放平台开通并发布权限后重新授权。浏览器显示成功但脚本不退出时，使用最新代码重试，不要重复创建状态。

旧版已授权的机器可手动补齐：

```bash
npm run bridge:status
```

## 安装

```bash
bash bridge/install.sh --mode real                 # 预演，不写入
bash bridge/install.sh --mode real --apply         # 安装 LaunchAgent
```

无需再填日历 ID。real 模式运行时由 App ID/App Secret 自动获取并缓存 `tenant_access_token`。Keychain 服务名是 `tc002-focus-bridge`，关键条目为 `shared_secret`、`app_id`、`app_secret`、`user_open_id`、`system_status_id`。

## 运行时 API

- 开始专注：`POST /personal_settings/v1/system_statuses/{id}/batch_open?user_id_type=open_id`，`end_time=focus_deadline`。
- 提前退出：`POST /personal_settings/v1/system_statuses/{id}/batch_close?user_id_type=open_id`。
- 自然到期：不再调 Lark，由 `end_time` 自动解除。
- 失败指数退避重试，但到 `focus_deadline` 后丢弃过期动作。

## 开发自测

```bash
export BRIDGE_SHARED_SECRET=$(openssl rand -hex 32)
export LARK_SYSTEM_STATUS_ID=status-test LARK_USER_OPEN_ID=ou_test
export BRIDGE_LARK_MODE=dry BRIDGE_PORT=8791
node bridge/server.mjs
```

`dry` 模式不发网络请求；`fake` 只允许连接 `127.0.0.1`；`real` 只连接 `https://open.larksuite.com` 且必须设置 `BRIDGE_ACK_REAL_LARK=YES`。

时钟发送的 `POST /focus` 协议、HMAC 签名和隐私字段白名单保持不变。执行 `npm test` 可验证幂等、断线重试、自然到期与提前关闭。
