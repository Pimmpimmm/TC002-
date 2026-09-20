# TC002 Focus Probe

This is a temporary, non-persistent FlyThings Z21 probe derived from Ulanzi's
official `Z21_TC002_Demo` (GPL-3.0-or-later).

## What it proves

- Middle-button press while idle publishes a `start` envelope (default 45 minutes).
- Middle-button press while active publishes `stop`.
- Clockwise or anti-clockwise rotation while active publishes `stop` with
  `reason=rotate_away`.
- Network work runs on a worker thread; the key/UI thread never waits for MQTT.
- Failed MQTT events remain ordered in a small in-memory retry queue.
- Focus and rest completion stop on a red prompt (`该休息了` / `该工作了`);
  the middle button is required to enter the next phase.
- READY is white, FOCUS is green, and REST is blue. The countdown does not
  flash red near its end.
- Rotating switches between the focus READY page and a stock-font UTC+8
  `HH:MM:SS` page; pressing the middle button on the time page starts focus.
- A naturally completed focus or rest round plays `ui/audio/focus_done.mp3`
  in loop mode until the middle button is pressed. Replace that file to change
  the music without changing code.
- While on the focus page, the left and right top buttons decrease/increase
  volume from 0 to 6 and briefly show a native-style volume overlay.

Default broker fallback: `192.0.2.100:1883` (documentation-only; use `device.conf`)

Exact topic: `ulanzi/tc002-focus/events/focus`

For the per-user computer deployment, place an optional `device.conf` beside the
runtime bundle. The application checks `/mnt/extsd/focus-app/device.conf` first,
then `/tmp/ui/device.conf`, and falls back to the compiled defaults above:

```ini
broker_host=192.0.2.100
broker_port=1883
event_topic=ulanzi/tc002-focus/events/focus
focus_seconds=2700
rest_seconds=300
```

This keeps the same binary usable with every user's local EMQX; the computer's
companion installer only needs to write that small per-device config file. The two
timer values accept `1..14400` seconds and take effect after restarting the app.

No Lark token, MQTT password, message text, user identity, device serial or MAC
is embedded in the application.

## Safe first run

1. Open/import this folder in the official FlyThings IDE as a Z21 project.
2. Compile with `Ctrl+Alt+Z`.
3. Configure Wi-Fi ADB for the TC002 IP.
4. Use **Download Debug** (`Ctrl+Alt+R`) only. Do not build or install an image.
5. Power cycling restores the official app.

The official boot guard and MCU-before-LED initialization remain in
`src/logic/mainLogic.cc`.

## Reproducible manual build

FlyThings' official Z21 compiler is an x86_64 Linux executable, so it cannot
run directly on an Apple Silicon Mac. `build-linux-x86_64.sh` builds the probe
inside an x86_64 Linux VM/container when these paths are mounted:

- project: `/project`
- official toolchain: `/toolchain`
- downloaded FlyThings packages: `/packages`

The default result is a temporary ADB debug bundle in `TemporaryFocusRelease`,
with `/tmp` runtime paths and a SHA-256 manifest. Set `BUILD_DIR` and
`DEPLOY_DIR=/mnt/extsd` explicitly only when preparing a separately reviewed
persistent-layout bundle. The script deliberately
includes only the two required activities and excludes the demo's audio, BLE,
RGB and Wi-Fi test modules. It also supplies the `__PLATFORM_Z21__` define that
the official IDE normally injects automatically.

The checked-in `TemporaryFocusRelease` is the tested deployment artifact used by
the macOS GUI. `companion/verify-runtime-bundle.sh` validates it before any ADB
write. Persistent firmware installation remains intentionally unsupported until
recovery has been validated on a separate physical device.
