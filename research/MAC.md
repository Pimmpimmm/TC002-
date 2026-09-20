# macOS notification fallback boundary — 2026-08-31

Installed overseas client evidence: `/Applications/LarkSuite.app` → bundle id `com.larksuite.larkApp`, version `143.0.7499.203`. `/Applications/Lark.app` is a separate `com.electron.lark`; the recommended target is the overseas `LarkSuite.app` selected by this task.

| Tier | Permission | What a bridge can learn | Reliability / verdict |
|---|---|---|---|
| Public `UserNotifications` | ordinary app permission | Its own delivered notifications only; not another app’s queue | Cannot observe Lark. Apple also says delivery is not guaranteed. |
| Accessibility-visible banner | Accessibility | Potentially observe a currently rendered Notification Center banner, map the visible app identity to `com.larksuite.larkApp`, and timestamp locally without retaining text | Permission absent and was not requested. Banner-only observation misses or reshapes events; unsuitable as a reliable source. |
| Notification database | Full Disk Access or equivalent privacy bypass | Historical rows may include source and time, but also prohibited sender/body metadata | Explicitly refused: excessive privilege, privacy violation, schema unstable. |

Risk cases: muted conversations may emit no banner; Focus may suppress/delay; Lark foreground behavior may avoid a system banner; grouping/coalescing can turn many messages into one UI item; banner recreation and AX callbacks can duplicate; restart loses in-memory dedupe and past banners; macOS/Lark upgrades can change bundle/app naming and accessibility structure. A bounded in-memory debounce reduces duplicates but cannot repair omissions. Thus Mac fallback is best-effort telemetry only and is not in the recommended production path.

`probes/mac-notification-boundary.m` compiles against public frameworks, confirms the target bundle and that cross-app notifications are unavailable, preflights AX without prompting, and refuses database access. It never reads a notification title/body/sender.
