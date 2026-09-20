# BLOCKED — 2026-09-11

## 0. 2026-09-03 最高优先：本轮会话的可用外壳不是该 macOS 主机（证据置顶）

**期望值**（`research/environment.txt`，2026-08-31 在 macOS 主机采集）：macOS `26.5.2` / build `25F84` / arm64、Node `v24.18.0`、npm `11.16.0`、Swift `6.3.3`。

**本轮实测值**（2026-09-03，本会话唯一可用外壳）：

```text
$ cat /etc/os-release | head -1     PRETTY_NAME="Ubuntu 22.04.5 LTS"
$ uname -m                          aarch64
$ node --version                    v22.23.2
$ npm --version                     10.9.8
$ sw_vers                           bash: sw_vers: command not found
$ xcrun swiftc --version            bash: xcrun: command not found
$ ls -d /System /Library/Preferences /Users        No such file or directory (三者皆无)
$ ls "$HOME/Library/Group Containers/group.com.apple.usernoted/db2/db"   No such file or directory
```

**网络边界实测**：

```text
$ /dev/tcp/192.0.2.253/1883          connect: Network is unreachable
$ curl -D- http://192.0.2.1/         HTTP/1.1 403 Forbidden ; X-Proxy-Error: blocked-by-allowlist
$ curl http://192.0.2.253/           http=403（与 .1 相同 → 证明是代理拦截，不是设备应答）
$ curl https://open.larksuite.com/   exit 56（连接被代理拒绝）
```

**影响**：本轮无法复跑任何真机 TC002 MQTT/HTTP 探针，无法编译或运行 macOS Objective-C 通知探针，也无法访问 `open.larksuite.com`。因此 2026-09-02 的真机结论既不因本轮升级，也不因本轮降级；本轮只做软件层红→绿复验与文档裁决补全。仅挂载 `~/Documents`、`~/Desktop` 两个目录，仓库位于 `~/Documents/ChatGPT/时钟`。

**精确补证步骤**：在该 Mac 本机终端于仓库根目录依次运行 `sw_vers && node --version && npm --version && xcrun swiftc --version`、`npm test`、`npm run probe:secrets`，并把本轮修复的两处探针缺陷（见 `research/VALIDATION.md` 2026-09-03 段）各跑一次红/绿；真机捕获按 `research/REAL-DEVICE-CAPTURE.md` 逐秒清单执行。

**安全说明**：该外壳环境变量中含代理用户名/口令，已刻意不写入任何交付文件；`npm run probe:secrets` 复扫通过。

**副作用告知（本轮唯一对仓库以外的痕迹）**：该外壳禁止删除文件（`rm` → `Operation not permitted`），git 因此无法清理自己的临时文件。结果是：① 每次在该外壳里跑 `git status` / `git add` 都会残留一个 `.git/index.lock`，本轮已通过重命名为 `.git/stale-index-lock-*` 清除，最终状态无 `index.lock`；② `.git/objects/*/tmp_obj_*` 留下若干零字节临时对象，无害，`git gc --prune=now` 可清。**在该外壳内请用 `git --no-optional-locks status` 只读查看，避免再产生锁文件。**

## 1. 遗留条目（2026-09-02 状态，未改动）

## 2026-09-01 narrowed Busy-calendar MVP

1. **Numeric evidence mismatch (highest priority):** the read-only Studio record for the saved TC002 reports firmware `1.1.1`, MCU `V1.0.17`, and native BUSY Clock `45` busy minutes + `5` rest minutes. The hard Lark rule is `entry + 30 minutes`. The recommended bridge therefore keeps the confirmed 30-minute absolute Lark deadline and does not alter the device, but it will not coincide with the currently configured native rest transition. If “30 minutes” was intended to mean “when this device enters rest”, that behavior is blocked until the requirement or device setting is explicitly changed; this round may not change long-term TC002 settings.
2. **Reliable native BUSY signal is absent on the proven stock surfaces:** real firmware `1.1.1` successfully connected to the temporary private broker. Proven stock MQTT is `[prefix]_[device]/status` retained `online`, startup `getBase`, plus inbound DIY subscriptions. The full second 90-second capture stayed connected and received only the T+0 retained status replay; on 2026-09-02 the user confirmed completing all four scheduled physical actions and multiple extra native BUSY switches during that run. `/getBase` is identity-only and `/getToolsConfig` is static configuration-only. This is now a verified physical negative for the tested firmware and public/proven paths, so the native-button requirement is blocked unless Ulanzi supplies an official unpublished state contract or new stock firmware behavior. The temporary MQTT configuration was restored and the broker stopped; no display payload was sent, but the final physical screen cannot be remotely confirmed.
3. **Calendar-to-visible-status — 用户已确认（2026-09-11）**：用户明确表示"创建了日程然后同步更改状态，别人是可以看见的"，并在被追问时再次确认"确实可见"。据此该条不再作为前置阻塞；仍保留一条留痕要求：第一次真实 create/delete 时顺手确认一眼同事视角，把结果写回本条。以下为原始记录（仅存档）：

   **Calendar-to-visible-status behavior unverified (superseded by the 2026-09-11 user confirmation above):** the official SDK proves user-token create/delete and `free_busy_status=busy`; customer support says it indirectly displays personal status. A real overseas Lark tenant still must verify propagation and deletion behavior. This round is prohibited from changing actual Lark status.
4. **Administrator nuance:** calendar calls can use the same user's OAuth token and do not inherently need the tenant-token system-status scope. A tenant's custom-app publishing/install/scope policy may still require administrator approval; “only myself” does not guarantee exemption.

## Broader original scope retained

1. **Evidence conflict / highest priority:** Studio’s TC002 guide says the desktop app supports TC002, but the public UlanziDeckPlugin SDK “Supported Devices” list omits TC002 and exposes events only for configured actions. No evidence connects it to the built-in BUSY page; plugin use is blocked as an architecture premise.
2. **Native BUSY event unavailable on tested stock interfaces:** device identity/reachability, versions, MQTT transport, derived topic shape and empty-credential behavior are real-device verified. The user confirmed all four scheduled actions and additional native BUSY switches during the valid full 90-second capture, while no BUSY frame appeared. No further identical rerun is required. Exact remediation is an official firmware-specific BUSY topic/read-only live-state endpoint, or a newer stock firmware whose documented behavior can be retested without flashing or replacing the native UI.
3. **Transient notify unverified:** official TC002 MQTT material omits the publish topic and demonstrates only DIY display. No official HTTP/MQTT stock-overlay schema proves ≤5-second disappearance, automatic return and unchanged settings. No reminder was sent.
4. **Studio implementation boundary, not a version blocker:** Studio `3.2.11` and device firmware `1.1.1` are now recorded. The installed private TC002 plugin is metadata/resources whose control client is compiled into the Studio host; it provides D200-family → TC002 commands but no proven reverse native-key event.
5. **Lark tenant execution unverified:** no test Custom App, tenant-admin approval, token, self open_id or real system_status_id was provided. By rule, no actual status call was made; docs/types and a token-free request builder are complete.
6. **Mac fallback intentionally not elevated:** Accessibility preflight is false and no prompt was requested; notification database access was refused. Therefore banner behavior across mute/Focus/frontmost/grouping/restart/upgrade remains unverified and cannot be called reliable.
7. **Custom-FlyThings alternative is conditional:** the official source proves the middle-key callback (`0x69`) and on-device C++ apps, but it does not prove a ready-made device MQTT/HTTP client, app coexistence with the stock BUSY page, persistence of a session deadline, or a safe no-brick deployment path. Any implementation requires explicit permission to deploy/test a custom app and must keep Lark credentials on the Mac only.
