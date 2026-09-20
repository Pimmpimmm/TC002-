# Lark boundary evidence — overseas Lark

## Personal status call chain

1. Use a tenant Custom App on `open.larksuite.com`; the status endpoints do not support a personal-only app identity.
2. Tenant grants `personal_settings:status:system_status_operate` for `batch_open` and `batch_close`. The app authenticates with `tenant_access_token`. The official error `2005007 Tenant does not have permission to api` confirms the decision is tenant-level.
3. Resolve the operator’s application-scoped `open_id` through a user-authenticated setup flow or an admin-provisioned deployment value. Use `user_id_type=open_id`; this avoids the optional `contact:user.employee_id:readonly` field permission.
4. Resolve/configure `system_status_id`. Calling the list endpoint dynamically adds `personal_settings:status:system_status_update`; to minimize runtime permission, obtain the ID during admin setup and store it with app credentials in macOS Keychain, not this repository.
5. On verified native BUSY entry, POST `/open-apis/personal_settings/v1/system_statuses/{id}/batch_open?user_id_type=open_id` with exactly one item and `end_time=floor(now/1000)+1800`. Treat `result_list[0].result`, not HTTP 200 alone, as success.
6. On verified early exit, POST matching `batch_close` with exactly `[self_open_id]`. Repeating close is the safe compensating action; repeating open must reuse the original absolute deadline rather than extend it.
7. Reconnect compensation: if the bridge has authoritative retained/current BUSY state and the original deadline is future, re-open with that deadline; otherwise close. If TC002 supplies only lossy edge events, reconnection cannot be reliable and the gate fails.

**Does one-person targeting avoid administrator approval? No.** `user_list` length one limits the affected user but does not change the Custom App, tenant token or tenant permission. Operationally, a tenant administrator must approve/publish/install the self-built app with the requested tenant scopes. The last sentence is an inference from the official tenant-level model; no permission was requested in this study.

## `im.message.receive_v1` coverage

| Message class | Official coverage | Minimum condition | Real-tenant test |
|---|---|---|---|
| User → bot private chat | Yes, conditional | bot capability + `im:message.p2p_msg:readonly` (or write variant) | Unverified |
| Ordinary user ↔ user private chat | No | Event is defined as messages received by the bot; no listed permission turns it into a personal-account firehose | Not applicable |
| Ordinary group message | Yes, conditional | bot is in that group + sensitive `im:message.group_msg:readonly` (or write variant) | Unverified |
| Group @bot | Yes, conditional | bot is in that group + `im:message.group_at_msg:readonly` (or write variant) | Unverified |

Therefore official capture cannot cover all messages received by the user’s personal Lark account. Special duplicate pushes are documented; dedupe by `message_id`, never `event_id`. The receiver should inspect only event type, `message_id`, `create_time` and routing class, immediately discard `content/sender/mentions`, never log the event body, and emit only `{source:lark, arrived_at}` to the display path.

`probes/lark-status-dry-run.mjs` constructs both requests and the 30-minute deadline without accepting a token or making a network call. No real status was changed.
