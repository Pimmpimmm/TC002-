# Probe validation — 2026-09-02

## Red (expected non-zero)

- `node probes/tc002-discover.mjs` → exit 2, `ALARM TC002 not identifiable...`.
- `node probes/tc002-capture.mjs --check` → exit 2, missing `MQTT_BROKER`.
- notify with duration 9 → exit 2, duration must be ≤5.
- `node probes/lark-status-dry-run.mjs` → exit 2, missing `LARK_OPEN_ID`.
- Mac AX preflight → exit 3, Accessibility absent and not requested; database mode → exit 4 and refuses access.
- Swift compile attempt failed because the installed compiler 6.3.3 and CLT SDK 6.3.2 mismatch; replaced with Clang/Objective-C to avoid a toolchain/system change. First unbundled CLI notification-center call aborted (exit 134), proving it is not a valid cross-app technique; public probe was narrowed accordingly.

## Green (safe local/fake inputs; no external mutation)

- `npm test` → 3/3 pass (literal topic/credential rejection, payload redaction, MQTT packet construction).
- discovery with documentation-only `192.0.2.10` → exit 0 and redacted hosts.
- capture `--check` with loopback broker/prefix → exit 0 and exact T+00…T+90 checklist; it did not claim real events.
- notify dry-run with `{"text":[{"content":"有新消息"}],"duration":5}` → exit 0, content redacted, no request sent.
- Lark dry-run with fake IDs and fixed epoch → exit 0; open deadline is exactly +1800 seconds and close targets the same one ID; no token accepted.
- Clang build + public Mac mode → exit 0: `framework_available=true ... other_apps_visible=false notification_content_read=false`.

`package-lock.json` contains no dependency. Nothing was installed; no key, chat content, firmware, Lark status or system/device setting was read or changed.

## 2026-09-01 Busy-calendar MVP additions

### Red (expected non-zero)

- `node probes/lark-calendar-dry-run.mjs` → exit 2, `ALARM missing required LARK_CALENDAR_ID`.
- `LARK_CALENDAR_ID=primary-test LARK_USER_ACCESS_TOKEN=forbidden node probes/lark-calendar-dry-run.mjs` → exit 2 and refuses the credential variable.
- `node probes/ulanzi-source-audit.mjs` → exit 2, missing `ULANZI_PLUGIN_SDK_DIR`.

### Green

- `npm test` → 5/5 pass, including private/no-notification Busy event, +1800 deadline, 64-character idempotency key, cleanup request, topic/device-identifier redaction, opaque-binary omission, and literal-only notification enforcement.
- Fake-input calendar dry-run → exit 0; printed `user_access_token`, primary-calendar lookup, redacted calendar ID, private Busy create and notification-free delete; no request made.
- Pinned official source trees plus installed Studio manifest → exit 0; public models are `D200/D200H/Dial/D200X`, action events are action-context-bound, TC002 repo is compile/flash scoped, installed TC002 plugin is `PrivateAPI` and `Deck models -> TC002 remote control`.
- Read-only Studio executable scan found the TC002 action command strings and configuration endpoints, but no readable current-page/current-BUSY query or TC002→Studio key callback. This strengthens the direction finding but is not promoted to a public protocol guarantee.
- Negative notification-content probe with `Alice: secret` → exit 2 before network access; only the exact literal `有新消息` is accepted as visible text. Capture dry-run now prints `[PREFIX]/#`, and persisted topics replace the literal device prefix with `[PREFIX]`; opaque binary payload bytes are omitted and represented only by length plus SHA-256.
- Real capture refuses any duration other than exactly 90 seconds. A broker-connect failure returned non-zero and the SHA-256 of the existing `research/tc002-events.redacted.jsonl` was identical before/after (`97d638bb...5003`), so a failed attempt cannot erase the prior evidence/status record.
- Credential-pattern scan found no Lark app ID, real `open_id`, Bearer token or PEM private key in the allowed deliverables. The direct-status dry-run validates supplied IDs but prints only `[SYSTEM_STATUS_ID]` and `[SELF_OPEN_ID]`.
- `ULANZI_UCLOCK_DATA=/private/tmp/does-not-exist.json npm run probe:studio:audit` → exit 2 with an explicit parse alarm. `npm run probe:studio:audit` → exit 0 and emits only masked IP/MAC, versions, built-in type/durations, neighbor-match booleans and MQTT presence booleans; it never emits serial, broker, prefix, username, password, token, API key, city or DIY content.

No dependency was added in that 2026-09-01 validation. The official repositories were cloned read-only into a temporary directory for inspection. Studio/device configuration, firmware, Lark data and credentials were not changed or read.

## 2026-09-02 private broker addition

Dependency decision: `aedes` `1.1.2` is exact-pinned as a devDependency because it is a lightweight MQTT 3.1/3.1.1 broker compatible with the installed Node 24 (`engines: node >=20`). It replaces the need for a system-level EMQX/Mosquitto installation. `npm run probe:broker:install` performs `npm ci --ignore-scripts` from the committed lockfile into ignored `probes/.runtime`; it added 27 packages and registers no service.

### Red

```text
$ MQTT_BROKER=mqtt://127.0.0.1:28883 MQTT_PREFIX=tc002_probe npm run probe:broker:self-test
ALARM broker self-test failed: connect ECONNREFUSED 127.0.0.1:28883
exit 2
```

The first sandboxed attempt also exposed and then fixed a probe bug: the self-test had created its delivery timeout before CONNECT, causing a second unhandled rejection after a connection failure. It now starts the timeout only after CONNECT/SUBSCRIBE and emits one explicit alarm.

### Green

The broker was bound only to loopback for the software test, automatically stopped after 30 seconds, and recorded payload size/hash rather than content:

```text
broker_ready bind=127.0.0.x:28883 topic=[PREFIX]/# credentials=disabled payload_logging=hash-and-size-only
PASS broker CONNECT/SUBSCRIBE/PUBLISH loopback; payload was synthetic and content-free
publish topic=[PREFIX]/self-test qos=0 retain=false bytes=14 sha256=c775500e...e0720a91
broker_stopped reason=duration_elapsed
```

Final regression: `npm test` → 7/7 pass; `npm run probe:secrets` → `PASS no secret-shaped values in 33 deliverable files`; `npm audit --package-lock-only --audit-level=high` → `found 0 vulnerabilities`. No TC002/Studio setting, firmware, Lark state, system service, or system permission was changed in that software-only validation.

## 2026-09-02 real TC002 connection and restoration

Red→green compatibility findings:

- Strict `[prefix]/...` ACL produced repeatable `client_error`; official screenshot evidence and the live device require `[prefix]_[device]/...`. The revised ACL accepts only the configured literal or a bounded alphanumeric device suffix and redacts that suffix as `[DEVICE]`.
- Treating zero-length MQTT username/password buffers as credentials produced repeatable category `auth` errors. The revised broker accepts only absent/zero-length fields and still rejects any non-empty credential.
- After both fixes, the device reached `client_authenticated` and `client_connected`, published retained `[PREFIX]_[DEVICE]/status` (`online`) and startup `getBase`, and subscribed only to redacted DIY topics.
- The first capture exposed a probe keepalive bug at T+45. The MQTT client now advertises 120 seconds. The second capture connected at `2026-09-02T03:27:30.067Z`, disconnected normally at T+90, and wrote one T+0 retained status line; no later publish was recorded. On 2026-09-02 the user confirmed completing all four scheduled physical actions and multiple extra native BUSY switches during that run, so this is a verified physical negative for the tested stock MQTT surface.
- Device-side restoration check: HTTP 200 with `enabled=false`, `address_empty=true`, port `1883`, prefix present, username/password absent and HA discovery false. `lsof -nP -iTCP:1883 -sTCP:LISTEN` returned exit 1 with no output after broker shutdown.
- The first unit test for the reusable HTTP audit failed 7/8 because the candidate matcher omitted camelCase `currentPage` while detecting `remaining`. After fixing camelCase/underscore matching, `npm test` passed 8/8. `TC002_FROM_STUDIO=YES npm run probe:tc002:http` then returned HTTP data without raw values: `getBase` had only `appVer/devSn/ip/mac/mcuVer/ssid`; `getToolsConfig` had static tool names and BUSY fields `enable/focusTime/relaxTime`; both reported `live_candidate_paths=[]`.
- Final secret scan after adding the HTTP probe: `PASS no secret-shaped values in 34 deliverable files`. The sole retained event is labeled `phase=setup`, never `enter_busy`.

## 2026-09-03 复验（非 macOS 外壳；仅软件层）

外壳为 Ubuntu 22.04.5 aarch64 / Node `v22.23.2`，无 LAN、无 WAN（见 `BLOCKED.md` 第 0 条）。因此本段只复验不依赖真机与外网的探针，并修复本轮暴露的两处缺陷。

### 本轮发现并修复的两处探针缺陷

1. `probes/tc002-discover.mjs` 在缺少 `/usr/sbin/arp` 的主机上抛出未包装异常 `spawnSync /usr/sbin/arp ENOENT`，**退出码 1 且无 ALARM**，违反"失败能响"。已改为捕获后抛 `ProbeError`。
2. `probes/lark-status-dry-run.mjs` **不拒绝**凭据环境变量（`LARK_TENANT_ACCESS_TOKEN=t-forbidden` 时仍退出 0），与 `lark-calendar-dry-run.mjs` 的行为不一致。已抽出共享守卫 `assertNoCredentialEnv()`（`probes/lib/safety.mjs`，覆盖 `LARK_USER_ACCESS_TOKEN` / `LARK_REFRESH_TOKEN` / `LARK_APP_SECRET` / `LARK_TENANT_ACCESS_TOKEN`），两个 dry-run 同时使用，并补 1 条单测（8 → 9）。
3. 顺带加固 `exitOnError()`：非 `ProbeError` 异常现在也统一加 `ALARM unexpected probe failure:` 前缀，避免再出现"静默失败"。

### Red（修复后，均非 0 退出且显式报警）

```text
$ node probes/tc002-discover.mjs
ALARM neighbor-cache discovery unavailable on this host (/usr/sbin/arp: ENOENT); set TC002_DEVICE_IP explicitly (no blind LAN scan performed)          exit=2
$ node probes/tc002-capture.mjs --check
ALARM missing required MQTT_BROKER                                                exit=2
$ node probes/lark-status-dry-run.mjs
ALARM missing required LARK_OPEN_ID                                               exit=2
$ LARK_TENANT_ACCESS_TOKEN=t-forbidden … node probes/lark-status-dry-run.mjs
ALARM dry-run refuses credential variables: LARK_TENANT_ACCESS_TOKEN              exit=2
$ node probes/lark-calendar-dry-run.mjs
ALARM missing required LARK_CALENDAR_ID                                           exit=2
$ LARK_USER_ACCESS_TOKEN=forbidden … node probes/lark-calendar-dry-run.mjs
ALARM dry-run refuses credential variables: LARK_USER_ACCESS_TOKEN                exit=2
$ node probes/ulanzi-source-audit.mjs
ALARM missing required ULANZI_PLUGIN_SDK_DIR                                      exit=2
$ TC002_NOTIFY_DURATION_SECONDS=9 … node probes/tc002-notify.mjs
ALARM notify duration must be >0 and <=5 seconds                                  exit=2
$ TC002_NOTIFY_PAYLOAD_JSON='{"text":[{"content":"Alice: secret"}],…}' … node probes/tc002-notify.mjs
ALARM notify string at content must be the literal 有新消息 or a safe structural value   exit=2
$ TC002_NOTIFY_MODE=carrier_pigeon … node probes/tc002-notify.mjs --execute
ALARM missing required TC002_ACK_DEVICE_TEST                                      exit=2
```

### Green（假输入/回环，无任何外部写入）

```text
$ npm test                                        # tests 9 / pass 9 / fail 0        exit=0
$ TC002_DEVICE_IP=192.0.2.10 … probes/tc002-discover.mjs
{"parameters_ready":true,"device":"192.0.2.x","broker":"127.0.0.x:1883","prefix":"[PREFIX-REDACTED]","method":"environment","identity_status":"user_supplied_unverified"}   exit=0
$ MQTT_BROKER=mqtt://127.0.0.1:1883 MQTT_PREFIX=tc002_probe … probes/tc002-capture.mjs --check
…逐秒清单 T+10/T+25/T+40/T+55/T+70/T+90 完整输出，未声称收到真实事件            exit=0
$ NOW_EPOCH_SECONDS=1788140000 … probes/lark-status-dry-run.mjs
"mutates_lark": false / "token_type": "tenant_access_token (not supplied in this dry run)" / "end_time": 1788141800   exit=0
   → 1788140000 + 1800 = 1788141800，+30 分钟精确成立
$ NOW_EPOCH_SECONDS=1788140000 LARK_CALENDAR_ID=primary-test … probes/lark-calendar-dry-run.mjs
"deadline": 1788141800 / "idempotency_key_length": 64 / delete 带 need_notification=false   exit=0
$ TC002_NOTIFY_PAYLOAD_JSON='{"text":[{"content":"有新消息"}],"duration":5}' … probes/tc002-notify.mjs
dry_run:true，target 为 [TOPIC-REDACTED]，并列出四项必需画面证据，未发出请求        exit=0
$ node probes/secret-scan.mjs
PASS no secret-shaped values in 34 deliverable files                              exit=0
```

未运行：`probe:broker`、`probe:capture`（真实 90 秒）、`probe:tc002:http`、`probe:notify -- --execute`、`probe:mac:build` / `probe:mac`、`probe:studio:audit`、`probe:ulanzi:audit` —— 全部依赖真机 LAN、macOS 工具链或本机安装的 Studio，本轮外壳不具备。未发送任何提醒，未修改 Lark、固件、Studio 或系统设置。

