# FEASIBILITY — decision as of 2026-09-02

> **Current handoff override (2026-09-11):** the implementation target is now 45 minutes focus + 10 minutes rest (`2700/600` seconds). The `+1800` values below are historical evidence from the previous requirement; use [`HANDOFF.md`](HANDOFF.md) as the active implementation brief.

> **Current narrowed decision (2026-09-20):** the active MVP is TC002 focus start → public Lark Calendar Busy event → deadline cleanup → next focus creates a new event. Its only recommended architecture and updated Ulanzi/Lark evidence are in [`BUSY-CALENDAR-MVP.md`](BUSY-CALENDAR-MVP.md). The five decisions below preserve the completed broader BUSY/status/message study; its direct tenant status path is superseded for the current MVP by user-OAuth calendar events.

> Older paragraphs in this research folder may say “private” because they record an earlier probe contract. The shipped implementation and current README use `visibility=public`.
>
> **Observed numeric mismatch:** secret-safe Studio data records native BUSY as `45+5`, while the confirmed Lark deadline is `+30`. The five decisions keep `+30` as an independent hard rule; they do not claim it matches the device's current rest boundary.

## Five scenario decisions

1. **原生 BUSY 进入 → 不可做（固件 `1.1.1` 当前 stock 路径）**：[TC002 guide](https://bbs.ulanzistudio.com/thread-470-1-1.html) proves stock BUSY exists, but neither it nor the [plugin SDK](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK) exposes an event. Real stock MQTT emitted retained connectivity `status=online`, startup `getBase`, and DIY subscriptions; a valid full 90-second capture emitted no additional frame. On 2026-09-02 the user confirmed all four scheduled physical actions and multiple extra native BUSY switches occurred during that run, making it a verified negative for the observed MQTT surface. `TC002_FROM_STUDIO=YES npm run probe:tc002:http` reproduces that `/getBase` and `/getToolsConfig` expose identity/static configuration and zero named live-state candidates. Only an official firmware-specific stock state contract or changed stock firmware can reopen this verdict.
2. **提前退出 → 不可做（当前证据）**：the Lark calendar event can be deleted, but stock middle-key exit and rotate-away have no proven MQTT/HTTP signal. The retained `status` is device connectivity, not BUSY. Guessing from a timer violates the native interaction.
3. **30 分钟到期 → 有条件可做**：[official `batch_open`](https://open.larksuite.com/document/server-docs/personal_settings-v1/system_status/batch_open) requires one `open_id` plus epoch-seconds `end_time`; `NOW_EPOCH_SECONDS=1788140000 LARK_OPEN_ID=ou_FAKE123 LARK_SYSTEM_STATUS_ID=7101214603622940672 npm run probe:lark` reproduces exactly +1800 without a call. Conditions are tenant admin approval, valid IDs, per-user result handling, and a verified native-enter trigger.
4. **消息提醒后回原界面 → 有条件可做**：[official Lark event](https://open.larksuite.com/document/server-docs/im-v1/message/events/receive) covers bot DM and qualifying bot groups, not ordinary personal DMs/all personal messages. No official TC002 transient-overlay contract was found or tested. Pass only after `npm run probe:notify -- --execute` with an official candidate produces a filmed ≤5-second overlay, automatic exact return and unchanged settings. [Apple UserNotifications](https://developer.apple.com/documentation/usernotifications) cannot make the Mac fallback reliable: public API cannot see Lark, AX banners are lossy/fragile, and database access is prohibited.
5. **离线重连 → 不可做（当前证据）**：the bridge can preserve its own absolute deadline, but the only retained TC002 value observed is device connectivity `online`; no retained/queryable current BUSY state or original BUSY start exists in the proven MQTT/HTTP surface. An offline physical entry/exit therefore cannot be reconstructed.

## 三个必答问题（明确回答，2026-09-03 复核）

> 本轮（2026-09-03）唯一可用外壳不是该 macOS 主机，无法复跑真机/系统级验证，故以下回答不新增真机证据、也不升级任何既有裁决；证据链见 `BLOCKED.md` 第 0 条。

**Q1「只改本人」是否免除管理员？→ 直接状态路径：否。日历替代路径：有条件。**

- 直接 `batch_open` / `batch_close` 走 `tenant_access_token` 与 `personal_settings:status:system_status_operate`（来源 6、9）。`user_list` 只放 1 个 `open_id` 只限制"影响谁"，不改变应用身份与租户级授权模型；官方错误码 `2005007 Tenant does not have permission to api` 也把判定放在租户层。因此仍需租户管理员审批/发布/安装自建应用。动态调用 `list` 还会追加 `personal_settings:status:system_status_update`（来源 10），故 `system_status_id` 应在安装期取得并存 Keychain。
- 日历替代路径用本人 OAuth `user_access_token` 创建/删除本人主日历的私密 Busy 日程（来源 11、12），不需要上述 status 高级权限；但自建应用本身的创建/安装/scope 授予仍受租户策略约束，可能依然需要管理员。
- 精确补证步骤（真实海外租户，≤10 分钟）：① 开发者后台该应用「权限管理」中确认两个 status scope 是否标注需管理员审批；② 以本人 OAuth 取 `user_access_token` 调 `GET /open-apis/calendar/v4/calendars/primary`，返回 200 即证明日历路径不依赖 status 审批。二者结论写回本节，勿反推。

**Q2 用户个人账号「全部消息」能否官方捕获？→ 不能。**

- `im.message.receive_v1` 是机器人视角事件（来源 7）。四类覆盖矩阵（详表见 `LARK.md`）：机器人私聊=有条件可覆盖；群内普通消息=有条件可覆盖（机器人在群 + 敏感 `im:message.group_msg:readonly`）；群内 @机器人=有条件可覆盖；**普通人↔人私聊=不可覆盖**，官方没有把个人账号全部消息转成事件流的 scope。
- 结论：以官方事件为唯一来源时，"有新消息"提醒对人-人私聊必然漏报，这是设计缺口而非配置问题。四类中三类目前均为「未验证（缺真实租户）」。
- 精确补证步骤（≤10 分钟）：真实租户内建一个测试机器人，按四类各发 1 条，只记录是否收到事件及 `message_id` / `create_time`，不落盘正文；矩阵"Real-tenant test"列由 Unverified 改为实测值。

**Q3 Mac fallback 可靠吗？→ 不可靠；只能算 best-effort 遥测，不进推荐生产路径。**

- 已实测：`probes/mac-notification-boundary.m` 公共模式退出 0 并输出 `framework_available=true … other_apps_visible=false notification_content_read=false`；辅助功能预检为 false 且按规则未申请；通知数据库需完全磁盘访问，按硬规则明确拒绝（`MAC.md`）。
- 漏报/重复来源：静音会话可能不出横幅；专注模式抑制或延迟；Lark 前台时可能不走系统横幅；通知聚合把多条并成一条 UI 项；横幅重建与 AX 回调可能重复；重启丢失内存去重；macOS 或 Lark 升级可改变 bundle 命名与 AX 结构。有界内存去抖只能压制重复，无法修复漏报。
- 因此不能承诺"消息提醒"的到达率，也不能用它替代官方事件覆盖缺口。
- 精确补证步骤（需另行获批，本轮禁止执行）：在获授辅助功能后运行 AX 层探针，对 20 条测试消息分别在"默认 / 静音会话 / 专注模式 / Lark 前台"四种条件下统计到达率与重复率；到达率任一条件 <100% 即维持"不可靠"结论。

## Original broader architecture (superseded for the current MVP)

```text
TC002 official firmware ── verified retained BUSY state/event ──┐
                                                               v
                                                       Mac bridge state machine
Lark bot WS events ── metadata-only filter/dedupe ──────────────┤
                                                               ├─ tenant Lark status API
Keychain: app secret/open_id/status_id                           └─ verified official TC002 transient notify

Excluded from production: custom/flashed TC002 page, Studio plugin assumption,
setConfig/carouselSpeed, AWTRIX/TC001 substitution, Mac notification DB, AX fallback.
```

State machine: `IDLE --native_enter--> ACTIVE(deadline=now+1800, batch_open)`; `ACTIVE --native_exit|rotate_away--> CLOSING(batch_close) --> IDLE`; `ACTIVE --deadline--> IDLE` (server expiry, close on reconciliation); `ANY --link_loss--> UNKNOWN`; `UNKNOWN --retained/current BUSY + future original deadline--> ACTIVE/replay`, otherwise `batch_close -> IDLE`. Independently, a covered Lark `message_id` goes `RECEIVED -> metadata-only dedupe -> transient notify -> RETURN_CONFIRMED`; failure to confirm return disables further display writes.

Minimum permissions and privacy: Custom App; `personal_settings:status:system_status_operate`; optionally `personal_settings:status:system_status_update` only during status-ID setup; choose only the bot message scopes matching approved chats. Secrets/IDs in Keychain; no body/sender logging or persistence; display literal only; no notification DB/FDA/Accessibility in the recommended path.

Remaining unknowns: any unpublished official stock BUSY topic/state endpoint or changed stock-firmware behavior; official transient-notify topic or HTTP route and restore semantics; real-tenant calendar permission/visible-status behavior and the four message cases. The physical MQTT-negative result, firmware and Studio versions are verified. These map exactly to `BLOCKED.md` and are not inferred as passes.

Next-phase implementation checklist:

1. Gate A failed on firmware `1.1.1`: do not repeat the same capture; obtain an official native BUSY state/event contract or documented newer stock-firmware behavior first.
2. Gate B: obtain an official TC002 notify contract; film immediate overlay, ≤5-second removal, exact return and before/after settings.
3. Tenant admin approves a one-user test Custom App; verify status result enums, automatic 30-minute expiry, early close and the four message classes without logging bodies.
4. Only after a replacement for failed Gate A and Gate B both pass, implement the launchd Mac bridge, Keychain credentials, retained-state reconciler, metadata-only Lark receiver and circuit-broken display adapter.
5. Fault-test broker/Lark outages, duplicate events, restart at each state and clock skew. If A fails, stop rather than substitute a custom UI or firmware.
