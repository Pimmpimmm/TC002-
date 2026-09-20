# 当前进度

## 已实现

- TC002 专注/休息状态机、本地响铃、MQTT 事件与 Mac 桥接。
- 专注开始直接调 Lark Personal Settings `batch_open`，带绝对 `end_time`。
- 提前退出调 `batch_close`；自然到期不再调 Lark。
- OAuth 自动获取用户 `open_id`，创建或复用租户内“专注中”系统状态。
- 运行时使用 `tenant_access_token`，由 App ID/App Secret 自动获取和缓存。
- 安装时不再需要日历 ID；新 Mac 上 clone 后依次执行 `bootstrap-macos.sh`、`bridge/setup-lark-oauth.sh`、`companion/install-macos.sh --apply` 即可。
- 完整回环测试 35 项通过；设备运行 bundle 和可移植性校验通过。

## 新电脑首次运行前

1. 在 Lark 自建应用中配置 OAuth 回调 `http://127.0.0.1:8788/oauth/callback`。
2. 开通系统状态列表、创建、批量开启和批量关闭所需权限，并按租户政策完成发布/管理员审批。
3. 运行 `bash bridge/setup-lark-oauth.sh`。
4. 使用真实 TC002 验证一次：开始出现“专注中”，提前退出立即关闭，自然到期自动消失。

旧日历探针保留在 `probes/` 和部分 `research/` 历史文档中，不再是生产路径。
