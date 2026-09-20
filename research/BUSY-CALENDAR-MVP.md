# TC002 focus → Lark calendar Busy MVP — 2026-09-02

> **Superseded implementation timing (2026-09-11):** the active target is 45 minutes focus + 10 minutes rest (`2700/600` seconds). This document preserves the earlier `+1800` probe/evidence. The current handoff is [`HANDOFF.md`](HANDOFF.md).

> **Visibility update (2026-09-20):** the shipped bridge now creates `visibility=public` events. The private examples below are historical probe records, not the current deployment contract.

## Decision

**Overall: the Lark Calendar half is conditionally feasible, but the requested end-to-end interaction is not implementable on tested stock TC002 firmware `1.1.1`.** The valid real-device capture now proves the current public/proven MQTT and read-only HTTP surfaces do not expose native BUSY entry/exit. The design remains dormant unless Ulanzi supplies an official state contract or changed stock firmware; the public Ulanzi Studio SDK does not provide that signal.

The target interaction is now unambiguous:

- Official **BUSY Clock** is the continuously red native busy indicator listed in the TC002 section of Ulanzi Studio.
- The user confirmed on 2026-09-01 that a short press of TC002's physical middle button enters that native BUSY Clock. The earlier task also records that the same button exits it.
- The separate official Pomodoro tool and its 25+5 cycle are out of scope. The 30-minute deadline belongs to the Mac/Lark bridge: BUSY entry creates a calendar event ending at `entry + 1800`, regardless of whether TC002 itself displays a countdown.
- Current read-only Studio data distinguishes Focus Clock type `304` from BUSY Clock type `305`. The saved BUSY configuration is `45` busy minutes + `5` rest minutes, not 30. Because `entry + 30 minutes` is a confirmed hard Lark rule and changing device settings is prohibited, the architecture intentionally keeps an independent 30-minute Lark deadline; it must not describe that deadline as the device's current rest transition.

## What “Ulanzi Studio plugin” actually provides

### Why the installed TC002 plugin is not an `.exe`

There are two different extension forms behind the word “plugin”:

- A public Ulanzi Studio Node/HTML plugin is a directory containing `manifest.json`, resources, and JavaScript/HTML. Studio is the host and launches or loads its code, so the plugin does not have to be a standalone executable. An `.exe` is a Windows executable format; on macOS the corresponding host executable is a Mach-O binary inside the `.app` bundle.
- The bundled TC002 integration is a private, first-party adapter. Its plugin directory contains only `manifest.json`, locale files, and images—no JavaScript, Node entry point, dynamic library, or executable. The implementation is compiled into Ulanzi Studio's main Mach-O executable. Read-only strings identify `tc002client.cpp`, `Tc002Client::sendAction`, `setBrightness`, and the commands `ccw`, `knob`, `shortPress`, and `middle`.

Its effective direction is therefore:

```text
D200-family action
  -> Studio reads the TC002 manifest/action UUID
  -> compiled Tc002Client in the Studio host
  -> LAN command
  -> TC002
```

This implementation can make TC002 perform a Busy toggle, but it does not establish the reverse path `TC002 physical middle key -> Studio plugin event`. Our deliverable should consequently be a separate per-user Mac bridge (initially a Node process managed by `launchd`, optionally packaged later as a native `.app`/Mach-O executable), not a TC002 Studio plugin. It will run without Studio once a stock BUSY state source is proven.

The public SDK is action-centric, not a general TC002 event bus:

- `manifest.md` says every action is assigned to a device key and lists supported models as `D200 | D200H | Dial | D200X`; TC002 is absent.
- `run`, `keydown`, `keyup`, `setactive`, and dial events carry `uuid`, `actionid`, and `key`/`context`. They describe the plugin action instance configured on a Deck key.
- No public SDK source names stock TC002 BUSY entry/exit or a global TC002 page-change event.

The installed Studio bundle removes the remaining ambiguity. Its bundled TC002 plugin manifest says:

> Connect to Ulanzi TC002 via D200/D200H/D100H/D200X over LAN. Easily adjust brightness and remotely control the app.

It is marked `PrivateAPI: true` and exposes only `Brightness` and `App Control`. This is a **Deck model → TC002 remote-control** plugin. It is not a plugin running on TC002 and cannot observe a press made on TC002 itself. The app-control tooltip includes page turning, volume, and Busy toggle, which proves remote control exists, not reverse event delivery.

The official `Ulanzi-U-Clock-TC002` repository is open device-development material, but its README explicitly scopes it to compiling and flashing/downloading an application. It contains hardware demos, not the stock BUSY/Pomodoro implementation. Using it would replace the native application and violate the no-flash/no-sideload/native-interaction rules.

Re-run the source boundary audit after cloning the official repositories:

```sh
ULANZI_PLUGIN_SDK_DIR=/path/UlanziDeckPlugin-SDK \
ULANZI_COMMON_NODE_DIR=/path/plugin-common-node \
ULANZI_TC002_SOURCE_DIR=/path/Ulanzi-U-Clock-TC002 \
npm run probe:ulanzi:audit
```

## Route comparison

| Route | Preserves TC002 physical/native flow | Can prove native focus start now | Support/reliability | Decision |
|---|---:|---:|---|---|
| Public Studio Node/HTML plugin | No evidence | No | Public events belong to configured Deck actions; TC002 absent from public model list | Exclude from main path |
| Bundled Studio TC002 private plugin | Remote-controls TC002 from D200-family hardware | No reverse event | Private API and wrong direction | Exclude |
| Passive stock MQTT | Yes | No on firmware `1.1.1` | Full connected capture plus confirmed repeated physical actions produced only retained connectivity `online` | Current gate failed |
| Read-only stock HTTP (`getBase`/`getToolsConfig`) | Yes | No on firmware `1.1.1` | Live responses contain identity/static settings, no current page/phase/start/deadline | Current gate failed |
| FlyThings/C++ device app | No | Yes, if built | Requires downloading/flashing a replacement app | Exclude |
| Mac/Deck button starts both sides | Changes the interaction | Yes | Technically straightforward but violates the native TC002-button requirement | Only if requirement is explicitly relaxed |

## Only recommended architecture, if an official state source appears

```text
TC002 stock BUSY Clock
  └─ verified retained MQTT BUSY state/session event
       (read-only HTTP BUSY state is acceptable only if real-device evidence proves it)
          └─ Apple Silicon Mac LaunchAgent bridge
               ├─ session dedupe + crash reconciliation
               ├─ macOS Keychain: Lark OAuth/refresh token
               └─ Lark Calendar v4 using user_access_token
                    ├─ focus start: private Busy event, now → now+1800
                    └─ deadline: delete event without notification
```

Studio is useful for device discovery/configuration and as evidence, but is not a runtime dependency in the recommended path.

### State machine

```text
IDLE
  -- authoritative NATIVE_BUSY_ENTER(session_id, started_at) -> CREATING
CREATING
  -- create success(event_id, absolute_deadline) --------> ACTIVE
  -- retry/duplicate ------------------------------------> same idempotency key
ACTIVE
  -- same session start ---------------------------------> ignore
  -- authoritative NATIVE_BUSY_EXIT ---------------------> CLEANING
  -- authoritative ROTATE_AWAY_FROM_BUSY ----------------> CLEANING
  -- absolute_deadline ----------------------------------> CLEANING
CLEANING
  -- DELETE success/already absent ----------------------> REST
  -- DELETE unavailable before deadline -----------------> retry with bounded backoff;
                                                           event end_time remains fail-safe
  -- DELETE unavailable after deadline ------------------> REST (event has already expired)
REST/NORMAL
  -- next authoritative NATIVE_BUSY_ENTER --------------> CREATING with a new key
ANY
  -- restart --------------------------------------------> reconcile stored event_id/deadline;
                                                           never extend the original deadline
```

Early manual exit is required: the same authoritative stock signal must distinguish middle-button exit and rotate-away from BUSY, and either transition deletes the event immediately. An edge-only MQTT event is not enough for reliable offline recovery; after a Mac/broker outage the bridge needs retained current BUSY state plus the original start/deadline, or the design remains best-effort.

## Lark request chain

1. A user OAuth flow obtains `user_access_token` and refresh capability for the same person. This avoids the tenant-token system-status API path.
2. Query the current user's primary calendar with `POST /open-apis/calendar/v4/calendars/primary` and retain its `calendar_id`.
3. On the first authoritative start signal for a session, create one event with a stable 32–128-character `idempotency_key`.
4. Save only `event_id`, session key, `started_at`, and absolute deadline. At the deadline, delete that event with `need_notification=false`.
5. If deletion fails, the event's `end_time` still bounds the Busy interval; retry deletion only to remove calendar clutter.
6. A new focus session gets a new idempotency key and event. Duplicate delivery for the same session reuses the old key and never pushes the deadline forward.

Dry-run request construction:

```sh
LARK_CALENDAR_ID=primary-test \
NOW_EPOCH_SECONDS=1788140000 \
FOCUS_SECONDS=1800 \
npm run probe:lark:calendar
```

The constructed event is `visibility=private`, `free_busy_status=busy`, has no attendees, description, location, meeting, reminder, or notification. The probe refuses token/secret environment variables and performs no request.

Minimum user scopes to confirm in the overseas Lark developer console are `calendar:calendar:read`, `calendar:calendar.event:create`, and `calendar:calendar.event:delete`. The API operation itself is user-identity/self-calendar and does not inherently require the tenant-token system-status permission. However, a tenant may still require administrator approval to publish/install the custom app or approve user scopes; “only myself” cannot bypass that tenant governance policy.

The remaining Lark truth test is real-tenant UI behavior: verify that a private, no-attendee event marked Busy changes the intended visible personal state, how quickly desktop/mobile/another viewer update, and whether deletion clears it. Customer support says the calendar route can indirectly display personal status; no real status/event was changed in this round.

## Exact TC002 go/no-go result

The required stock-firmware probe was completed on 2026-09-02:

1. Firmware `1.1.1`, MCU `V1.0.17`, Studio `3.2.11`, and the native BUSY tool were recorded without changing BUSY configuration.
2. The second 90-second MQTT capture remained connected from T+0 through T+90. The user confirmed T+10 enter, T+25 exit, T+40 enter, T+55 rotate away, plus multiple extra switches during that run.
3. Only the T+0 retained connectivity value `online` appeared; no native BUSY discriminator or later device publish appeared. Gate failed.
4. Live read-only `/getBase` and `/getToolsConfig` responses exposed only identity and static tool configuration, with `live_candidate_paths=[]`. HTTP fallback failed.
5. Because no retained/current BUSY state or original start time exists in the proven surface, disconnect recovery cannot pass and was not promoted by guessing.

If neither stock MQTT nor a read-only stock HTTP response exposes this state, the current native-button requirement is not implementable without firmware work. Do not substitute a Studio action or custom page and call it native.

## Next implementation phase, only after Ulanzi supplies a new authoritative source

1. Obtain an official firmware-specific native BUSY topic/endpoint contract or documented newer stock-firmware behavior, then repeat the same red→green probe before writing the adapter.
2. Add user OAuth authorization-code flow and store access/refresh tokens only in Keychain.
3. Implement calendar create/delete with the already validated request builder; persist only opaque event/session metadata.
4. Install as a per-user LaunchAgent and test reboot, duplicate starts, broker outage, Lark outage, clock skew, and cleanup retry.
5. Run one-person real-tenant acceptance: first focus creates exactly one Busy event; middle-button exit and rotate-away each delete it immediately; otherwise the deadline restores normal status and cleanup removes the event; rest creates nothing; next focus creates exactly one new event.

## Distance to implementation

- **Scaffold:** the process lifecycle, state machine, privacy boundary, and token-free Lark calendar request builder are defined and tested, but implementing them now would not produce the requested interaction.
- **Real TC002 adapter:** blocked by a verified negative on firmware `1.1.1`, not by plugin packaging. Do not repeat the same capture or build an adapter until Ulanzi provides a different official state source.
- **Reliable recovery:** also blocked because the only observed retained value is device connectivity `online`; no current BUSY state or original start time can be recovered.
- **Real Lark acceptance:** later requires an overseas Lark custom app, user OAuth calendar scopes, and one explicitly authorized create/delete test in the user's tenant. Tenant policy may still require an administrator to approve or install the app.

The stock MQTT/read-only HTTP gate was silent for native BUSY despite confirmed repeated physical actions. The native physical-button requirement is therefore unavailable on tested firmware `1.1.1` under the no-flash rule. This stops the TC002 integration until new official evidence appears; it does not justify substituting a Studio button or a custom device page.
