# TC002 native BUSY real-device capture — 2026-09-02

## Completed result

- Node `v24.18.0` and npm `11.16.0` are ready; the repository's MQTT client needs no `mosquitto_sub`.
- Aedes `1.1.2` is exact-pinned as a probe-only dependency under ignored `probes/.runtime`. It is not global or a system service. The temporary listener was stopped after capture.
- The real device was verified as firmware `1.1.1`, MCU `V1.0.17`; Studio was `3.2.11`. Live read-only `GET /getBase` and `GET /getToolsConfig` later succeeded but exposed only identity/static configuration, not current BUSY state.
- The valid second MQTT run stayed connected for 90 seconds and recorded only the T+0 retained connectivity value `online`. On 2026-09-02 the user confirmed performing the four scheduled actions and multiple extra native BUSY switches during that run. Start detection and early-exit gates therefore failed on the tested stock surface; recovery cannot pass because no current BUSY state/start time is available.
- The device was restored to MQTT off, address empty, empty credentials; port 1883 no longer had a listener. No display payload or Lark request was sent. The final physical screen remains user-confirmed-only and cannot be remotely inspected.

## Phase A — prepare the isolated capture path

1. Put the Mac and TC002 on the same trusted Wi-Fi. Open Ulanzi Studio and record locally:
   - TC002 firmware version;
   - Studio version;
   - TC002 IP;
   - current MQTT server, port and topic/prefix fields, if already configured.
2. Do not paste or save MQTT usernames/passwords in this repository. The probe intentionally rejects credentials embedded in `MQTT_BROKER`.
3. Prefer an already available private broker. If none exists, start a temporary user-space/local broker first; installing a system service is outside this round's rules. TC002 must connect to the Mac's LAN IPv4 on port 1883, not `127.0.0.1`.
4. If changing TC002's MQTT target temporarily, photograph/export the original values first and restore them immediately after capture. Do not alter BUSY, brightness, carousel, or other long-term settings.
5. Determine the literal TC002 topic prefix from Studio or the private broker's connection/subscription view. Do not guess it from AWTRIX/TC001. The official TC002 standard prefix/schema is still unpublished.

The official tutorial's documented topology is TC002 → local broker on the computer's LAN IPv4:1883, with an MQTT subscriber optionally monitoring device reports. It does not publish the required BUSY topic/schema.

## Phase B — dry check, then 90-second capture

From `/Users/panjunren/Documents/ChatGPT/时钟`:

Install/rebuild the ignored runtime strictly from `package-lock.json`:

```sh
npm run probe:broker:install
```

Start the broker for ten minutes in terminal 1. `BROKER_HOST` must be the Mac's actual trusted-LAN IPv4; the probe rejects `0.0.0.0`, non-local addresses, credentials, topics outside the literal prefix, and durations over 15 minutes:

```sh
BROKER_HOST=192.168.x.z \
BROKER_PORT=1883 \
BROKER_SECONDS=600 \
MQTT_PREFIX='literal/prefix' \
npm run probe:broker
```

Only after `broker_ready`, temporarily set the TC002 MQTT server to `192.168.x.z:1883` in Studio. Keep the BUSY/tool configuration unchanged. In terminal 2, use that same LAN address for the subscriber because the broker intentionally does not bind all interfaces:

```sh
TC002_DEVICE_IP=192.168.x.y \
MQTT_BROKER=mqtt://192.168.x.z:1883 \
MQTT_PREFIX='literal/prefix' \
npm run probe:discover
```

The device IP is used only for identity reporting; the subscriber connects to the broker. A successful dry identity check prints masked hosts. Then validate the capture parameters without connecting:

```sh
MQTT_BROKER=mqtt://192.168.x.z:1883 \
MQTT_PREFIX='literal/prefix' \
npm run probe:capture -- --check
```

Start a phone video containing the TC002 screen and a seconds clock. Then run:

```sh
MQTT_BROKER=mqtt://192.168.x.z:1883 \
MQTT_PREFIX='literal/prefix' \
npm run probe:capture
```

Perform exactly:

| Time | Physical action | Visual fact to film |
|---|---|---|
| T+00 | Start capture | Original native screen and seconds clock |
| T+10 | Short-press middle button | Native BUSY red screen appears |
| T+25 | Short-press middle button | BUSY exits and original screen returns |
| T+40 | Short-press middle button | Native BUSY appears again |
| T+55 | Rotate knob one detent | BUSY is left via native interaction |
| T+70 | No action | Original screen/settings remain unchanged |
| T+90 | End | Stop video only after probe exits |

The redacted MQTT frames are written to `research/tc002-events.redacted.jsonl`. Do not treat “captured > 0” as success by itself.

## Pass/fail decision

**Pass for start detection** only if the T+10 and T+40 entries correlate with the same stable topic plus a BUSY-specific field/value, and unrelated seconds/carousel/DIY traffic is distinguishable.

**Pass for early exit** only if both T+25 middle-button exit and T+55 rotate-away produce a stable non-BUSY/page/state transition.

**Pass for reliable recovery** requires a second run: disconnect the subscriber/broker, enter BUSY, reconnect, and observe a retained/queryable `BUSY=true` state. Edge-only messages are insufficient because a Mac outage can miss the press.

Fail and keep the native integration blocked if:

- zero device publishes arrive;
- only DIY display/subscription traffic appears;
- messages cannot distinguish BUSY from other native pages;
- the apparent event occurs only in Studio logs/private control actions;
- reconnect cannot recover the current state.

## If MQTT is silent

Use the TC002 IP for a second, read-only comparison of `GET /getBase` and `GET /getToolsConfig` before/after the same physical sequence. These endpoint names are present in the installed Studio binary but are not a published BUSY API. Raw responses may contain device identifiers or configuration and must not be committed. Only a repeatable live BUSY/page/state field passes; static tool configuration does not.

After the run, restore any temporarily changed MQTT values, confirm the original display, and record the fact in `PROGRESS.md`.
