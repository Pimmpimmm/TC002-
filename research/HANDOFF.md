# TC002 × Lark 联动转接文档

**版本：2026-09-11**  
**当前需求覆盖：专注 45 分钟 + 休息 10 分钟**

## 1. 要实现的用户体验

1. 在 TC002 的自定义 Busy 页面按一次中键，开始一轮 45 分钟专注。
2. Mac 收到一个不含正文的开始事件，修改**本人** Lark 状态为忙碌。
3. 45 分钟到期，TC002 播放一次铃声并切换到 10 分钟休息页面；Mac 删除/关闭本轮 Lark 忙碌状态。
4. 休息结束，自动进入下一轮 45 分钟 Busy，并重新创建/开启 Lark 忙碌状态。
5. 中途按中键或按约定旋钮操作退出时，立即结束本轮并清理 Lark 状态。

旧探针中的 `+1800`（30 分钟）是上一版需求的历史验证值；本文件的 `45+10` 才是当前实施目标。实现参数应使用：`busy_seconds=2700`、`rest_seconds=600`。

## 2. 已经确认的事实

- TC002 原生固件 `1.1.1` 的 MQTT/HTTP 没有捕获到原生 BUSY 进入、退出或旋钮切换事件；不能靠监听原生页面实现联动。
- Ulanzi 开源 SDK 的 `KeyManager` 暴露旋钮、旋钮按下、左键、中键、右键，但这是**自定义 FlyThings 应用内部**的回调，不是 stock BUSY 的全局事件总线。
- 自定义应用可使用 `AudioManager::playAudio()` 播放本地 MP3；因此铃声可以在时钟本地播放，不依赖 Mac。
- Ulanzi Studio 普通 Node/HTML 插件不是 TC002 内置应用，也没有证据能收到 TC002 原生中键事件。
- Lark 个人状态有两条路径：
  - 日历 v4：用户 OAuth 创建/删除本人私密 Busy 日程，权限相对低；是否在租户 UI 中等价显示为个人“忙碌”仍需真实租户验证。
  - `batch_open/batch_close`：直接操作系统状态，语义最明确，但要 `tenant_access_token`、`personal_settings:status:system_status_operate` 和租户管理员批准。

## 3. 唯一推荐架构

```text
TC002 自定义 FlyThings Busy 应用
  ├─ KeyManager：中键/旋钮事件
  ├─ 本地状态机：ACTIVE 2700 秒、REST 600 秒
  ├─ 本地倒计时与铃声
  └─ LAN 发送 start/stop 元数据
          ↓
Apple Silicon Mac LaunchAgent 桥接服务
  ├─ 校验来源、去重 session_id、保存绝对 deadline
  ├─ Lark OAuth/刷新令牌只存 macOS Keychain
  └─ 调 Lark Calendar create/delete（默认 MVP）
     或在管理员批准后调 batch_open/batch_close
```

设备只发送 `session_id`、`event`、`started_at`、`deadline`；不存 Lark token、聊天正文、发送者或日历隐私内容。

## 4. 状态机和接口约定

```text
IDLE/REST
  -- middle_press --> ACTIVE(deadline=started_at+2700, start)
ACTIVE
  -- middle_press/rotate_away --> REST(stop + delete/close)
  -- deadline --> REST(play bell + stop + delete/close)
REST
  -- rest_deadline --> ACTIVE(new session_id, new start)
```

Mac 桥接必须：

- 对相同 `session_id` 幂等；重复 start 不得延长 deadline。
- stop 指向同一个 session；重复 stop 视为成功。
- 重启后只恢复原绝对 deadline，不重新计算 45 分钟。
- Lark 离线时不影响 TC002 本地倒计时和铃声；恢复后补偿创建/删除，但不得补开已过期状态。

## 5. 你需要做的事情

### 现在先做（不改设备）

1. 把本文件交给开发者或技术群，明确询问下面的 5 个问题：
   - FlyThings 自定义应用中，`E_KEYCODE_MIDDLE_BUTTON (0x69)` 是否能稳定收到短按、连按和退出事件？
   - 自定义应用是否有官方可用的 HTTP 客户端；若没有，官方推荐的设备→Mac 通信方式是什么？
   - 能否通过 Wi-Fi ADB 临时运行而不持久写入，如何恢复官方应用？
   - 自定义应用能否在重启后保留 deadline，系统时间变化时应使用什么时钟？
   - `AudioManager` 播放 MP3 时是否会与系统按键音/原生滴答音冲突，是否有独立静音控制？
2. 让 Lark 管理员确认两种 API 路径的权限政策；若不想申请 tenant status 权限，优先走日历 OAuth。
3. 确认休息结束是否永远自动开始下一轮；若不是，把 `REST → ACTIVE` 改为等待中键。

### 获得明确授权后再做

1. 在真实 TC002 上先临时部署 FlyThings demo，验证中键/旋钮回调和铃声；不做持久刷写。
2. 用无内容的本地 HTTP 事件打通 TC002→Mac，验证断线、重连、重复事件。
3. Mac 先接本地 fake Lark 服务，再做一次明确授权的海外 Lark 创建/删除测试。
4. 验收 45+10：开始、提前退出、45 分钟到期、休息结束自动重启、Mac/Lark 离线、Mac 重启。
5. 通过验收后才做开机自启、Keychain、日志脱敏和正式打包。

## 6. 当前不能承诺的事项

- 在不部署自定义 TC002 应用的前提下，无法可靠保留原生 BUSY 中键作为触发器。
- 无法把普通个人 Lark 私聊全部转换成官方机器人事件；这与本转接文档的状态联动无关。
- 日历事件是否实时、稳定地显示为 Lark 个人“忙碌”，必须由真实海外租户验证；不能只凭客服说明当作实测结论。
- 自定义应用部署属于设备软件变更；在得到明确授权前，本轮不执行。

## 7. 交付验收标准

- 每轮专注严格 2700 秒、休息严格 600 秒。
- 每轮只创建一条本人 Lark 状态记录，提前退出立即清理。
- 到期只播放一次铃声，且不依赖 Mac 音频。
- 任何日志都不包含 token、聊天正文、发送者或完整日历内容。
- 设备断线/重启不会把旧轮次延长，也不会重复创建状态。

现阶段结论：**技术上可行，但前提是 TC002 运行自定义 FlyThings Busy 应用；stock 固件路径不可行。**
