# 安全问题

请不要在公开 Issue、Pull Request 或聊天中提交 Lark App Secret、OAuth Token、
refresh token、MQTT 共享密钥、设备凭据或完整钥匙串/日志内容。

如果你发现可能影响其他用户的安全问题，请先通过 GitHub 的 Private vulnerability
reporting 联系维护者，而不是公开披露利用细节。普通的授权失败、环境检查失败和
设备连接问题，请使用 Issue 模板并提供脱敏后的错误信息。

本项目的设计边界是：Lark 凭据只写入当前用户的 macOS 钥匙串；设备运行包不包含
Lark 凭据；MQTT 仅用于同一局域网内的本机助手链路。正式多人部署前仍应为 EMQX
启用用户名、密码和 ACL。
