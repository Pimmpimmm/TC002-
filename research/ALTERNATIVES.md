# TC002 ↔ Lark alternate implementation routes — 2026-09-11

> **Active timing override:** use `busy_seconds=2700` and `rest_seconds=600` for the current handoff. Any `1800`/30-minute values retained below are historical probe values from the former requirement and must not be copied into a new implementation.

## New evidence from the official open-source repository

The current official repository documents four relevant routes: PixDeck/web control, MQTT/Home Assistant, agent-status MQTT, and FlyThings device-app development. Its device demo exposes the TC002 hardware inputs, including `E_KEYCODE_MIDDLE_BUTTON = 0x69`, and a key callback. The companion Pixel Pet app confirms that a C++ app can run on the TC002 itself and receive top-button/knob events directly. This is a different capability from stock-firmware MQTT: it requires deploying a custom FlyThings app.

The same repository says FlyThings is compiled with the Windows IDE and downloaded over Wi-Fi ADB; persistent deployment produces an `update.img`, and the USB-C reset procedure restores the official firmware. This is an explicit firmware/app change and therefore requires separate user authorization. No Lark token may be placed on the device.

### What can be captured in a custom app

The official `KeyManager` API enumerates all input sources:

| Input | SDK symbol | Code / event |
|---|---|---|
| Knob clockwise | `E_KEYCODE_CLOCKWISE` | rotation event |
| Knob counter-clockwise | `E_KEYCODE_ANTI_CLOCKWISE` | rotation event |
| Knob press | `E_KEYCODE_KNOB_BUTTON` | `0x67` |
| Left button | `E_KEYCODE_LEFT_BUTTON` | `0x6C` |
| Middle button | `E_KEYCODE_MIDDLE_BUTTON` | `0x69` |
| Right button | `E_KEYCODE_RIGHT_BUTTON` | `0x6A` |

`KeyManager::addKeyEventCallback(cb)` receives these events inside the deployed application. This is not evidence of a global stock-firmware hook: a custom app must own the active page/process (or the stock application itself must be modified). There is no public proof that a background app can observe buttons while the untouched official BUSY page is foreground.

The official MQTT documentation and repository README define the stock route as **Mac/HA → TC002 Custom App**: UTF-8 JSON on `[PREFIX]/custom/[APP_NAME]`, with `duration`, `text`, `image`, and `draw`. The device must already be displaying that Custom App; MQTT content does not automatically switch from native BUSY to the Custom App. This route cannot observe the native BUSY middle key.

## Route comparison

| Route | Physical middle key remains trigger? | Firmware change? | Lark linkage | Decision |
|---|---:|---:|---|---|
| Stock TC002 + MQTT/HTTP Custom App | No | No | Mac receives an external trigger, then pushes a timer/notice | Only if trigger requirement is relaxed |
| D200 + Studio TC002 plugin | D200 key, not TC002 key | No | D200 action can be the Mac-side trigger; Studio sends TC002 remote commands | Conditional on owning D200; interaction changes |
| Lark/calendar → stock TC002 display | No (reverse direction) | No | Mac polls/subscribes to Lark and pushes a display | Useful one-way dashboard, not the requested flow |
| Camera/OCR/audio observation | Nominally | No | Mac guesses from pixels/sound | Exclude: lossy, privacy-heavy, not reliable |
| Custom FlyThings Busy app | **Yes, if the app replaces/launches the Busy experience** | **Yes** | App emits a tiny event to the Mac bridge; Mac alone owns OAuth and Calendar API | **Only viable route that preserves the TC002 middle key** |

## Recommended adjustable-clock design

If “时钟这一侧可以调整” includes deploying a custom TC002 app, use this architecture:

```text
TC002 custom FlyThings Busy app
  ├─ KeyManager callback: middle key 0x69 + knob rotation
  ├─ local red Busy countdown (30 minutes, not the stock 45+5 setting)
  ├─ local session record: session_id, started_at, deadline
  └─ LAN event (HTTP POST preferred; MQTT client only if SDK proof exists)
          ↓
Apple-Silicon Mac LaunchAgent bridge
  ├─ authenticate device event; reject duplicates/replays
  ├─ store only opaque session metadata in Keychain/local state
  └─ Lark Calendar v4 user OAuth
       ├─ enter → private Busy event, end = started_at + 1800
       ├─ middle exit/rotate away → delete immediately
       └─ deadline → event naturally expires; cleanup delete is best effort
```

The device sends only `enter`, `exit`, `rotate_away`, `session_id`, and timestamps. It never stores or sees a Lark access token, app secret, open_id, calendar title, message body, or sender. The Mac bridge remains the only component allowed to call Lark.

## Feasibility gates before any firmware write

1. Build the FlyThings demo in the Windows IDE and run it through Wi-Fi ADB **without persistence** first. Verify middle-key and rotation callbacks on the real TC002. Do not change the current official firmware permanently.
2. Prove one local device-to-Mac event transport with a content-free payload. The public demo proves Wi-Fi/BLE and key callbacks, but does not by itself prove a ready-made MQTT client API; HTTP client availability or an SDK-supported MQTT client is still a gate.
3. Recreate only the required Busy display behavior and verify the original native app can be restored with the reset procedure. Do not claim the custom page is the stock BUSY Clock.
4. Run the Mac bridge against a local fake Lark server, then obtain explicit authorization for one real overseas-Lark create/delete test.
5. Test disconnect/reconnect: the custom app must retain the original deadline and queue an exit; the Mac must never extend a session or create a duplicate event.

## Bottom line

- **No flash / no custom app:** there is no reliable way to keep the TC002 physical middle key as the trigger. Stock MQTT/HTTP is display-command-only.
- **Preserve the physical middle key:** custom FlyThings app deployment is technically plausible and supported by the open-source key callback, but it is a firmware/app replacement project, not a Studio plugin. It must be explicitly authorized and validated on-device before implementation.
- **Fastest usable compromise:** use a Mac hotkey or D200 action as the trigger and keep TC002 in a Custom App showing a 30-minute timer. This preserves the Lark behavior but changes the required TC002 interaction.

## End-of-focus sound

The official device SDK exposes `AudioManager::playAudio(path)`, `pauseAudio`, `resumeAudio`, `stopAudio`, and volume `0..6`; the example plays a local MP3 bundled with the app. A custom Busy app can therefore schedule a bell at its own `deadline` and switch to a rest screen at the same callback. This is a device-side feature, not a stock MQTT feature: the public stock MQTT/HTTP surface has no proven sound topic or native-BUSY bell trigger.

The app should bundle a short licensed audio file, play it once at the transition, and send the Lark cleanup event independently. The current stock BUSY `45+5` setting must not be silently reused because the Lark hard rule is `+30`; the custom app needs an explicit `busy_seconds=1800` and a separately chosen rest duration. Audio playback and timer callbacks must be tested on real hardware without blocking the UI thread.

The official Studio guide documents only a global device Volume setting (levels 1–4) for prompt sounds and sound-reactive feedback; it does not document separate controls for the native BUSY ticking sound versus an end-of-focus bell. Therefore stock firmware cannot currently be claimed to mute ticking while retaining its native bell. In the custom app, the native BUSY ticker is not running: the app draws its own countdown and calls `playAudio()` only once at the transition. Any platform-level key-click/beep behavior still needs a real-device audio test because the public SDK exposes no independent mute switch.

Sources: [official TC002 repository](https://github.com/UlanziTechnology/Ulanzi-U-Clock-TC002), [key callback demo](https://github.com/UlanziTechnology/Ulanzi-U-Clock-TC002/blob/main/Z21_TC002_Demo/README.md), [official MQTT guide](https://docs.ulanzistudio.com/tc002/en/software/mqtt.html).

## Copying the Busy screen is not the same as observing it

Copying the visual appearance of the native Busy Clock into a Custom App does not create an event source. A stock Busy page can still change pixels without exposing a BUSY-start, BUSY-stop, or rest-complete message; screen/OCR observation is lossy and is excluded from the reliable design.

The viable interpretation is a **custom FlyThings Busy app** that owns both the cloned drawing and the timer. Its `KeyManager` callback handles the middle key/knob, and its timer owns every transition:

```text
IDLE/REST --middle key--> ACTIVE (deadline = now + 1800)
ACTIVE --middle key or rotate-away--> REST/IDLE (delete calendar event)
ACTIVE --deadline--> REST (play one bell, delete/expire event)
REST --rest deadline--> ACTIVE (new session_id, new +1800 Lark event)
```

The Mac bridge receives only metadata events such as `start(session_id, deadline)`, `stop(session_id)`, and `cycle_start(session_id, deadline)`. It creates/deletes the user's private Lark calendar event; the TC002 never receives OAuth credentials. Thus the requested “休息结束自动回到 Busy 并再次让 Lark 忙碌” is technically implementable **only after** deploying and validating this replacement app. It is not implementable by leaving the official Busy app untouched and trying to capture its screen.

The automatic `REST → ACTIVE` transition must be an explicit product choice (rest length, behavior after reboot, and what happens if the Mac or Lark is offline). It must not silently reuse the stock `45+5` setting because the current Lark requirement is a separate `busy_seconds=1800` rule.

## Best implementation for status + bell

For the combined requirement, the recommended split is:

* **TC002 custom FlyThings app:** owns the middle-key/knob callbacks, draws the Busy/rest pages, keeps an absolute deadline, and calls `AudioManager::playAudio()` once at the focus-to-rest boundary.
* **Apple-Silicon Mac bridge:** is the only Lark client. It receives content-free `start/stop` metadata, performs an idempotent create/delete, and keeps the OAuth token in Keychain.

For the Lark mutation choose the least-privileged path that the tenant can approve:

| Lark operation | Advantage | Limitation | Recommendation |
|---|---|---|---|
| Calendar v4 create/delete with the user's OAuth token | No `system_status_operate` tenant scope; natural `+1800` end time and early deletion | Whether a private event is rendered as the exact personal “Busy” status is tenant/UI-dependent and must be tested | **Default MVP** |
| `batch_open`/`batch_close` system status with `tenant_access_token` | Directly targets the system-status object | Requires the status operation scope and tenant administrator approval; app identity is tenant-wide even when `user_list` has one person | Use when exact status semantics are required and admin approval is available |

The transition contract should be idempotent: `session_id` is generated on the device, `start` carries `deadline = started_at + 1800`, `stop` carries the same ID, and the Mac ignores duplicate or stale transitions. At `deadline`, the device plays the bell and sends `stop`; if the rest timer ends, it creates a new session and sends `start`. If the Mac is offline, the device still changes its display/sound locally; the bridge reconciles the event later without extending the original deadline.

This is the best technical design, but it is not available under the current no-flash/no-custom-deployment boundary. Until a temporary FlyThings deployment is explicitly authorized and verified on the real TC002, the best no-device-change fallback is a Mac hotkey or D200 action plus a Mac timer; that fallback does not preserve the TC002 middle-key requirement and is therefore not equivalent.
