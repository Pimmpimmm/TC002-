# SPEC v2 — TC002 × Lark 专注钟（45 + 5，闹钟式确认）

**版本：2026-09-11（取代 2026-09-11 转接文档 HANDOFF.md 中的 45+10 自动流转版本）**
**授权状态：用户已明确授权修改 TC002 设备软件（"这 clock 随便改"）。**
**Lark 租户：国际版，API base = `https://open.larksuite.com`（用户提供的 open.feishu.cn 文档内容等价，仅域名不同）。**

> 2026-09-20 实施更新：Lark 改为直接调用 Personal Settings API 开启/关闭“专注中”系统状态，不再创建日历日程；专注/休息时长由助手通过 `device.conf` 配置（默认 2700/300 秒）。

> 2026-09-18 设备交互更新（覆盖下文旧的“中键退出到 IDLE / 到期等待确认”规则）：首次中键从 `READY` 进入 `FOCUS`；`FOCUS` 中键提前进入 `REST` 并沿用原 `stop` 事件；`REST` 中键提前进入下一轮 `FOCUS` 并沿用原 `start` 事件。倒计时自然结束也自动进入下一阶段。旋钮仍退出循环回到 `READY`。Lark 日历 API 与 45 分钟忙碌生命周期不变。

> 2026-09-18 声音更新：仅 `FOCUS` 自然到期时播放一次 `/tmp/ui/audio/focus_done.wav`；提前按中键、旋钮退出均不播放。进入下一轮专注或退出循环时停止尚未播完的音频。右侧硬件键用于试听，左侧硬件键用于停止试听；试听不发送 MQTT、不改变 Lark。

---

## 0. 相对 HANDOFF.md 的 5 处变更（用户 2026-09-11 拍板）

| # | 项目 | HANDOFF.md（旧） | 本文件（现行） |
|---|---|---|---|
| 1 | 设备改造授权 | 需授权后才做 | **已授权**，可部署自定义 FlyThings 应用 |
| 2 | 时长 | 专注 2700 / 休息 600 | 专注 **2700** / 休息 **300**（与设备原生 45+5 一致） |
| 3 | 提前退出 | `ACTIVE → REST`（进入休息） | **`FOCUS → IDLE`**：切走即回空闲页，删除 Lark 日程 |
| 4 | 到期行为 | 响一次铃后自动进休息 | **闹钟式**：到期后**持续响铃**，按中键才进休息；休息结束同样持续响铃，按中键才开始下一轮 |
| 5 | Lark 路径 | 日历 MVP / status 备选 | **只走 Personal Settings v1** batch_open + batch_close（tenant token） |

用户 2026-09-11 追加决策（取代早先的"忙碌保持到确认"）：**日程到点自己过期，桥接不管它；下一轮进入 busy 时再创建一条新日程。** 因此 Lark 忙碌 = **严格 2700 秒**，宽限与 PATCH 延长默认关闭（参数保留，改配置即可启用）。响铃等待期间 Lark 已恢复空闲。

第 4 条的响铃保护也已确认采用：连续响 5 分钟后转为每 30 秒短促提示，直到按中键。

---

## 1. 用户体验（现行目标）

1. 时钟停在空闲页（自定义应用画的时钟页）。按一次中键 → 进入专注页，45:00 倒计时开始；Lark 上出现本人忙碌。
2. 倒计时走完 → 时钟**一直响铃**并显示"专注结束"，直到我按中键。
3. 按中键 → 进入休息页，5:00 倒计时；Lark 忙碌解除。
4. 休息走完 → 时钟**一直响铃**并显示"休息结束"，直到我按中键。
5. 按中键 → 开始下一轮 45 分钟（新一轮，新 Lark 忙碌）。
6. 任何时候我自己切走（中键在专注中按下 / 转旋钮）→ 立即回空闲页，Lark 日程删除、状态恢复。

---

## 2. 关于 FlyThings 与"原生界面"的说明（用户提问的回答）

用户原话：*"切换走不就等于回到原生态界面了吗？"* —— 这里有一个需要先讲清的前提：

- TC002 的原生时钟页 / 天气页 / BUSY 页都属于**原厂固件里的那一个应用**。自定义 FlyThings 应用不是叠在它上面的一层，而是**替换**它：自定义应用运行时独占屏幕，下面没有一个"原生界面"可以退回去。
- 因此"切走回到原生界面"在实现上只有两种可能：
  - **(A) 自定义应用自己画一个空闲时钟页**（推荐）：观感做成和原生时钟一致（大字时间 + 日期/温度），切走 = 回到这个页面。切换即时、完全可控、按键事件不丢。
  - **(B) 真正退出自定义应用、回到原厂 UI**：未经验证，可能需要重启，且退出后按键事件也就收不到了（下一轮没法再按中键触发）。
- **本规格按 (A) 实现**；(B) 作为真机 demo 阶段的可选验证项，不作为前提。
- 同时必须先问清（见 §7 问题 4）：部署自定义应用**是否会让原厂的时钟/天气/BUSY 等页面全部消失**、以及**能否刷回原厂固件**。用户已授权改设备，但"能不能还原"仍要有答案才动手。

---

## 3. 状态机（设备侧，权威定义）

参数：`FOCUS_SECONDS = 2700`、`REST_SECONDS = 300`、`RING_MODE = continuous_then_intermittent`（连续响 `RING_LOUD_SECONDS = 300`，之后每 `RING_INTERVAL_SECONDS = 30` 响一次短提示，直到按中键；不会自行停止，也不会自行切换状态）。

```text
IDLE  （自定义空闲时钟页；Lark 无日程）
  -- middle_press --------> FOCUS
        新 session_id；started_at = now；focus_deadline = started_at + 2700
        → 上报 event=start

FOCUS （45:00 倒计时；Lark 忙碌中）
  -- middle_press ---------> IDLE     提前退出，reason=user_exit   → 上报 event=stop
  -- rotate_away ----------> IDLE     提前退出，reason=user_exit   → 上报 event=stop
  -- now >= focus_deadline -> FOCUS_ALARM

FOCUS_ALARM （持续响铃 + "专注结束"；Lark 仍忙碌，见 §4）
  -- middle_press ---------> REST     reason=focus_ack   → 上报 event=stop
        rest_deadline = now + 300
  -- rotate_away ----------> IDLE     reason=user_exit   → 上报 event=stop（并停铃）

REST  （5:00 倒计时；Lark 无日程）
  -- middle_press ---------> FOCUS    提前结束休息，直接开下一轮（新 session_id）→ 上报 event=start
  -- rotate_away ----------> IDLE     停止循环
  -- now >= rest_deadline -> REST_ALARM

REST_ALARM （持续响铃 + "休息结束"；Lark 无日程）
  -- middle_press ---------> FOCUS    新 session_id → 上报 event=start
  -- rotate_away ----------> IDLE     停铃，停止循环
```

设备侧不变量：

- 倒计时用**单调时钟**推进，只在启动时用 RTC/NTP 校准绝对时间；系统时间跳变不得改变本轮剩余时间。
- `focus_deadline` / `rest_deadline` 为**绝对时刻**并落盘；断电重启后按绝对时刻恢复，已过期则直接进入对应 ALARM，**不重新计 45 分钟**。
- 铃声在设备本地播放，**不依赖 Mac、不依赖网络**。
- 上报失败（Mac 关机/断网）不阻塞 UI，不影响计时与铃声；失败请求进本地队列，最多重试 N 次后丢弃并在日志留一行 `ALARM`。

已确认（2026-09-11）：

- 响铃保护采用"连续 5 分钟 → 每 30 秒短提示"，不自动停、不自动切换。
- `REST` 倒计时未走完时按中键 = **休息够了，直接开下一轮**（新 session，新日程），不是退出到空闲。

---

## 4. Lark 系统状态契约（国际版）

### 4.1 调用

| 动作 | 方法 | 路径 | token |
|---|---|---|---|
| 列出系统状态（安装时） | GET | `/open-apis/personal_settings/v1/system_statuses` | `tenant_access_token` |
| 创建“专注中”（仅首次） | POST | `/open-apis/personal_settings/v1/system_statuses` | `tenant_access_token` |
| 开启本人状态 | POST | `/open-apis/personal_settings/v1/system_statuses/{id}/batch_open?user_id_type=open_id` | `tenant_access_token` |
| 提前关闭本人状态 | POST | `/open-apis/personal_settings/v1/system_statuses/{id}/batch_close?user_id_type=open_id` | `tenant_access_token` |

授权时通过 `/open-apis/authen/v1/user_info` 获取本人 `open_id`。状态定义在租户内复用，名称为“专注中”，图标 `StatusReading`，颜色 `GREEN`，优先级选当前未使用的最小正整数。

### 4.2 状态生命周期（严格 45 分钟，到点自然过期）

用户决策：**系统状态到点自己解除，桥接不去管；下一轮再开启同一状态。** 因此：

- 开启时 `end_time = focus_deadline = started_at + 2700`。
- **到达 deadline 后桥接对 Lark 不做任何调用**，状态由 `end_time` 自行结束。
- 提前退出时调 `batch_close`；失败进重试队列并指数退避，直到 `focus_deadline`。
- 若 `stop` 丢失或 Mac 一直离线，`end_time` 仍保证状态不会永久卡住。心跳只用于对账。

由此得到的好性质：桥接死掉、DELETE 失败、Mac 关机、网络断开，都不可能把忙碌卡住——最坏情况也只是忙碌完整显示 45 分钟。

---

## 5. 设备 → Mac 接口

设备只发元数据，本地 HTTP，`POST http://<mac-lan-ip>:<port>/focus`：

```json
{
  "v": 1,
  "session_id": "01J…（设备生成，每轮唯一）",
  "event": "start | stop | heartbeat",
  "state": "FOCUS | FOCUS_ALARM | REST | REST_ALARM | IDLE",
  "reason": "middle_press | rotate_away | user_exit | focus_ack | boot_recovery",
  "started_at": 1788140000,
  "focus_deadline": 1788142700,
  "sent_at": 1788140000
}
```

- 心跳：`FOCUS` / `FOCUS_ALARM` 期间每 60 秒一次。
- **禁止字段**：任何 token、聊天正文、发送者、状态文案、设备序列号、MAC。
- 鉴权：共享密钥 HMAC 头 + 只监听局域网地址；密钥存 Keychain，不进日志、不进设备日志。

Mac 桥接不变量：

1. 同一 `session_id` 的 `start` 幂等：重复不再开启状态、不延长 deadline。
2. `stop` 指向同一 session；重复 `stop` 视为成功；未知 session 的 `stop` 触发对账并记日志。
3. 状态落盘（含 `session_id` / `status_opened` / 绝对 deadline）；重启后只恢复绝对值，不重算。
4. Lark 不可用：指数退避重试；**不得补开已过期轮次**；恢复后先对账再动作。
5. token / refresh token 只在 macOS Keychain；日志脱敏（沿用 `probes/lib/safety.mjs` 的 redact 规则）。

---

## 6. 验收标准（v2）

1. 专注计时严格 2700 秒、休息严格 300 秒（本地单调时钟，误差 ≤1 秒）。
2. 到期后持续响铃，按中键才切换；不按不切换，不自动跳过。
3. 每轮只开启一次本人 Lark“专注中”状态；提前退出后 ≤5 秒关闭；重复 start/stop 不重复调用。
4. Lark 状态严格 = [开始, 开始+2700]，到期由 `end_time` 自行解除，桥接在 deadline 之后不再对 Lark 发任何请求。
5. 铃声本地播放，拔掉 Mac / 断网 / Mac 重启都不影响计时与铃声。
6. 设备断电重启：按绝对 deadline 恢复，不延长旧轮次、不重复开启状态。
7. 任何日志都不含 token、聊天正文、发送者或完整请求体。

---

## 7. 给 FlyThings 开发者/技术群的问题（可直接转发）

1. 自定义应用中 `E_KEYCODE_MIDDLE_BUTTON (0x69)` 的短按 / 长按 / 连按是否稳定可收？旋钮左右旋转与旋钮按下的 keycode 分别是什么？应用在息屏或后台时是否仍收到按键事件？
2. 自定义应用有没有官方可用的 HTTP 客户端（还是只有裸 socket）？官方推荐的"设备 → 局域网主机"通信方式是什么？能否设置连接超时与失败重试而不阻塞 UI 线程？
3. `AudioManager::playAudio()` 能否**循环播放 / 一直播放到手动停止**？能否控制音量、能否独立于系统按键音静音？与原生滴答音是否冲突？
4. 部署自定义应用是否等于**替换整机固件**——原厂的时钟 / 天气 / BUSY / 计时器页面是否全部消失？**能否刷回原厂固件，官方恢复包从哪里获取？** 能否用 Wi-Fi ADB 临时运行而不持久写入？
5. 重启后如何持久化一个绝对 deadline（有无 NVS / 可写文件系统 / 掉电安全写）？倒计时应该用哪个时钟（单调时钟 vs RTC vs NTP 校准），系统时间跳变时推荐怎么处理？
6. 屏幕策略：倒计时页能否长时间常亮且不烧屏？ALARM 页能否强制点亮屏幕？有无官方推荐的息屏/唤醒 API？

---

## 8. 施工顺序

- **S1（本地，不碰设备/不碰 Lark）**：把 §3 状态机 + §4 契约 + §5 接口做成 Mac 桥接实现 + dry-run 探针 + 单测；`GRACE`、`FOCUS_SECONDS`、`REST_SECONDS`、`RING_MODE` 全部可配置。
  - **S1 已完成（2026-09-11，`npm test` 21/21 全绿）**：
    - `bridge/lib/state.mjs`：纯函数状态逻辑——信封白名单校验（出现 `sender`/`content` 一类字段直接拒绝）、`focus_deadline - started_at` 必须精确等于 2700、start 按 `session_id` 幂等、提前退出排队 DELETE、deadline 之后零调用、离线时 start+stop 相互抵消不产生任何请求、心跳对账、失败指数退避、过期动作出队。
    - `bridge/lib/auth.mjs`：HMAC-SHA256 over `${timestamp}.${body}` + ±120 秒重放窗口 + 定长比较。
    - `bridge/lib/persist.mjs`：原子落盘，重启只恢复绝对 deadline。
    - `bridge/lib/lark.mjs`：三种模式 `dry`（零网络）/ `fake`（仅 127.0.0.1）/ `real`（必须 `BRIDGE_ACK_REAL_LARK=YES` + Keychain token）。
    - `bridge/lib/keychain.mjs`：`security find-generic-password` 读取 shared secret / app credentials / user_open_id / system_status_id。
    - `bridge/server.mjs`：`POST /focus`，仅绑本机地址，≤4 KB 请求体；启动即校验密钥长度、用户 ID、状态 ID 和时长。
    - `bridge/fake-lark.mjs`：回环假 Lark，可注入故障，用于 S5 断线/重试测试。
  - S1 待做：LaunchAgent plist + 首次安装脚本（写 Keychain 三项、生成共享密钥）。
- **S2（Lark 真租户，一次性配置）**：在 open.larksuite.com 建自建应用、开通系统状态相关权限、跑通本人 OAuth，自动获取 `open_id` 并创建/复用“专注中”。
- **S3（Lark 真租户）**：跑通一次 `batch_open` → `batch_close`，确认本人及同事视角的状态展示。
- **S4（设备）**：拿到 §7 答案后，先临时部署 FlyThings demo，只验证中键/旋钮回调 + 循环铃声 + 常亮，不做持久刷写。
- **S5（联调）**：设备 → Mac → 假 Lark 服务 → 真 Lark；按 §6 七条逐条验收。
- **S6（收尾）**：LaunchAgent 开机自启、Keychain、日志脱敏复扫、打包。

阻塞关系：S3 的忙碌显示若实测不成立 → 回到 `batch_open/batch_close` 并申请管理员批准；S4 问题 4 若答"不能刷回原厂" → 需你再次确认是否接受不可逆。当前唯一真正的前置阻塞是 §7 那六个 FlyThings 问题（设备侧一行代码都还没法写），Mac 侧不受它阻塞、已可继续。
