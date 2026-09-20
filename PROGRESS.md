# PROGRESS — 2026-09-11（第二轮：需求定稿 v2 + Mac 桥接 S1 完成）

1. **需求已由用户定稿，取代 `research/HANDOFF.md`**，权威规格为 `research/SPEC-V2-45-5.md`：
   - 设备改造：**已获用户明确授权**（"这 clock 随便改"）。
   - 时长：专注 **2700 秒** + 休息 **300 秒**。
   - 到期行为：**闹钟式**——专注/休息到期都持续响铃，必须按中键才切换；响铃保护 = 连续 5 分钟后转每 30 秒短提示，不自动停、不自动切换。
   - 提前退出：`FOCUS --中键/旋钮--> IDLE`（自定义空闲时钟页），立即删除日程。`REST` 中按中键 = 直接开下一轮。
   - **Lark 忙碌严格 2700 秒**：日程 `end_time` 到点自行解除，**deadline 之后桥接对 Lark 零调用**；下一轮再建新日程。宽限/PATCH 延长参数保留但默认关闭。
   - Lark 路径：只走日历 v4 create/delete，用户 OAuth；租户为**国际版**，base `https://open.larksuite.com`。
   - 用户明确表示"创建日程后状态同步、别人可以看见"，故 S3 不再作为前置阻塞，改为首次真实运行时确认一眼。
2. 已向用户说明 FlyThings 前提：自定义应用**替换**原厂应用，屏幕下面没有可退回的"原生界面"，空闲页由自定义应用自己画；"真正退回原厂 UI"仅作 demo 阶段可选验证，且必须先问清能否刷回原厂固件（`SPEC-V2-45-5.md` §7 问题 4）。
3. 本轮代码（全部本地软件；未碰设备、未碰真 Lark、未装系统服务）：
   - `probes/lib/lark-calendar.mjs` → v2 契约：默认 `2700 / grace 0 / maxExtensions 0`，`sessionId` 幂等键，输出 `focus_deadline`/`booked_end`/`busy_ceiling`/`delete_on_early_exit`，`extend_while_ringing` 仅在显式开启时出现。
   - **新增 `bridge/`**：`lib/state.mjs`（纯状态逻辑）、`lib/auth.mjs`（HMAC + 重放窗口）、`lib/persist.mjs`（原子落盘）、`lib/lark.mjs`（dry/fake/real 三模式）、`lib/keychain.mjs`、`server.mjs`（`POST /focus`，仅本机绑定，≤4 KB）、`fake-lark.mjs`（可注入故障的回环假 Lark）、`bridge.test.mjs`。
   - `probes/secret-scan.mjs` 扫描范围加入 `bridge/`；`package.json` 的 `test` 脚本改为同时跑 `probes/*.test.mjs bridge/*.test.mjs`，新增 `bridge`、`bridge:fake-lark` 脚本。
   - 新增 `.gitignore`（`.DS_Store`、`Claude outputs/`、`probes/.runtime/`、`node_modules/`）。
4. 红→绿实测（Mac 会话 VM，Node 22.23.2）：
   - `npm test` → **21/21 pass**（原 9 条 + 日历 v2 两条 + 桥接 11 条）。
   - 桥接绿：签名 HTTP 往返只创建一条日程且 `start/end` = `T0 / T0+2700`、`free_busy_status=busy`、`visibility=private`、带 `idempotency_key`；重复 start 不产生第二条；提前退出触发 1 次 DELETE；假 Lark 注入一次 503 后按 5 秒退避重试成功且不重复创建；deadline 之后 tick 不再发任何请求；重启后绝对 deadline 不变；离线时 start+stop 相互抵消、零请求；心跳报非 FOCUS 状态触发对账删除。
   - 桥接红：篡改签名 → 401；请求体 >4 KB → 413；非 `/focus` → 404；信封含 `sender` / 未知字段 / `session_id` 过短 / `focus_deadline-started_at≠2700` / `started_at` 超前 → 全部拒绝；启动期 `BRIDGE_LARK_MODE=real` 无 `BRIDGE_ACK_REAL_LARK=YES` → exit 2；密钥 <16 字符 → exit 2；`fake` 模式 base 非回环 → exit 2；非法 `GRACE_SECONDS` → exit 2。
   - `node probes/secret-scan.mjs` → PASS，45 个交付文件。
5. 追加：`rotate_away` 已进入 `reason` 白名单——旋钮切走与按中键走完全同一条 stop → DELETE（未知 reason 仍拒绝，如 `shake_device` → `ALARM unknown reason`）。提前退出时若 Mac 离线，DELETE 退避重试到 deadline 为止，之后由 `end_time` 兜底。
6. **S1 收尾已完成**：`bridge/install.sh`（默认预演，`--apply` 才写入；非 macOS exit 2；自动生成 32 字节共享密钥写 Keychain 三项，token 隐式输入）、`bridge/launchagent/com.tc002.focus-bridge.plist.template`（plist 内无任何密钥）、`bridge/send-test-event.mjs`（签名自测客户端 + `--print-recipe` 输出设备端签名算法）、`bridge/README.md`。真机联调冒烟已跑通：dry 模式下 start → 202 queued=1、重复 start → queued=0、`rotate_away` → DELETE、`shake_device` → 400，状态文件落盘正确。`npm test` 22/22，`secret-scan` 49 文件 PASS。
7. 无法在本会话验证：`install.sh --apply` 与 `launchctl`（会话 VM 是 Linux，无 `security`/`launchctl`）——plist 渲染路径已单独验证为合法 XML、无残留占位符、不含密钥，但首次安装需用户在 Mac 本机终端执行一次。
8. 仍未验证/未做：设备侧 FlyThings 应用（等 `research/FLYTHINGS-QUESTIONS.md` 六个问题的答复，当前唯一真正的前置阻塞）；真实 Lark 的一次 create/delete（S3）；未刷写设备、未改 Studio/固件/系统设置、未创建或删除任何真实日程。
9. 下一步入口：用户把 `research/FLYTHINGS-QUESTIONS.md` 发给开发者/技术群；用户在 open.larksuite.com 建自建应用并授 `calendar:calendar:read` / `calendar.event:create` / `calendar.event:delete`；然后做 OAuth 换 token 那一段与 S3 一次真实写测试。

## 追加（2026-09-11 晚）

10. 用户确认"私密忙碌日程对同事确实可见"，已写入 `BLOCKED.md` 第 1 节第 3 条并解除该前置阻塞（仍要求首次真实 create/delete 时留痕确认一次）。
11. FlyThings 六个问题**不再需要提问**：已从官方公开文档与 Ulanzi 官方仓库查到四问半的答案，写入 `research/FLYTHINGS-FINDINGS.md`。关键结论：`KeyManager` 六个 keycode 齐全（含旋钮左右旋/旋钮按下/中键）但只给 code、按压语义需自行判定；HTTP 走依赖包 `curl-cxx` 且必须异步（UI 线程不能阻塞）；音频 `sPlayer.play/stop/setVolume(0~1)` 无循环参数，循环铃声自行重触发；`StoragePreferences` 存 flash（勿频繁写）；FlyThings 基于 Linux，倒计时用 `CLOCK_MONOTONIC`，系统时间只用于生成上报 epoch；屏保超时可设 `-1` 关闭，`BRIGHTNESSHELPER` 控背光。**最关键**：官方仓库写明"下载调试不会固化，断电后恢复"、持久化用 `update.img` + FAT32 TF 卡、"按住 USB-C 旁的复位按钮上电，会自动刷回官方固件" → 设备变更可逆，临时验证零留痕。
12. 开发门槛核查：FlyThings IDE 为公开免费下载（仅 Windows，最新 20260403），**另提供 Linux 工具链 `ssd.tar.gz`（覆盖 SSD/Z20/Z21/Z261，Z21 即 TC002 平台）公开可下**，官方 TC002 demo 工程开源。无需厂商授权、无需签名密钥、无账号门槛。本会话云容器为 x86_64 Linux / 30 GB 可用，存在"不依赖 Windows 直接用 Linux 工具链编译"的可能，待验证（GUI 资源 `.ftu` 是否能脱离 IDE 构建是关键未知）。
13. 剩余只能真机验证的 4 条见 `research/FLYTHINGS-FINDINGS.md` 末尾；验证方式统一为"下载调试模式临时跑 demo，断电即恢复"。
