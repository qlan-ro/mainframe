# Forward Claude's attention requests to Mainframe notifications (#293)

## Problem

The Claude CLI can decide mid-turn that the user should be interrupted and calls a `PushNotification` tool
with a short message — "the migration needs a decision before I continue", "the build is failing on your
branch". Its own delivery path is terminal-only. Running as a Mainframe child process, Claude has no terminal
to escalate into, so the message reaches nobody: it lands as an unrecognized tool card in the transcript, the
tool result reports that nothing was sent, and the user finds out whenever they next look at the session.

Mainframe already has the plumbing this message needs. It notifies for exactly two things — Task Complete and
Session Error — and each fans out to connected clients and to registered mobile devices. What it does not do
is raise an OS-level notification on the desktop, even though the desktop shell holds the notification
permission and the capability is present but never called. So the one message Claude explicitly flags as
worth interrupting a person for is the one message that never interrupts anyone.

## Behavior

### When Claude asks for attention

A Claude session that calls the attention tool raises one Mainframe notification carrying the tool's message.
The notification appears in three places, all from the same event:

- **In the app** — the session is marked unread in the sessions list, exactly as Task Complete does today.
- **On the desktop** — a native OS notification, titled **"Claude needs your attention"**, with the tool's
  message as its body. Every running desktop client raises one; a notification is a per-device thing.
- **On mobile** — a push to registered devices, same title and body, sent only when no desktop client is
  active. The existing desktop-active suppression rule decides this; a desktop user gets the banner, not a
  phone buzz.

The notification fires when Claude *makes* the call, not when the CLI writes the result back. It fires
regardless of what the result says: the CLI's own "the user is already present / notifications are off / I
have no transport" reasoning describes a terminal Mainframe does not own. Any of them still means Claude
wants the user's attention. It fires even when the user is looking at that very session.

Messages longer than the notification body limit are truncated with a trailing ellipsis, never dropped.
Newlines and markdown in the message are shown as plain text.

### In the transcript

The tool call renders as a normal tool card on the same material as the other tool cards, with the message as
its body — one line where it fits, clamped at two. It is not hidden and not a progress line: a notification
that fires with no transcript trace is confusing when the user comes back to read the session.

The result the CLI writes back is untouched and displays as the card's outcome. Mainframe never rewrites,
suppresses, or fabricates it — including when it says nothing was sent.

### The setting

The notifications settings pane gains one switch in the existing **Chat** group, beside Task Complete and
Session Error, labelled **"When Claude asks for your attention"** with the description "Notify when Claude
interrupts to ask for you". It defaults on. `PushNotification` is CLI vocabulary the user never sees;
naming the tool here would be the only place in the app that leaks it.

With the switch off, the tool call produces no notification of any kind — no unread mark, no OS notification,
no push — and no error and no warning in the logs. The tool call still renders in the transcript. The switch
is read when the call arrives, so flipping it takes effect on the next call without restarting the session.

### Deduplication

Two calls carrying the identical message in the same session within one minute raise one notification. The
same text after the window, different text back to back, or the same text in a different session each raise
their own.

### What does not change

Task Complete and Session Error behave exactly as they do today: unread mark and mobile push, no OS
notification. Their settings toggles are untouched. A session that never calls the tool emits no new events
and no new log lines.

## Not Included

- `deferred` — Clicking the OS notification to focus the session. It arrives with no click action; the user
  switches to the app themselves.
- `deferred` — Naming the session in the notification title. Titles stay event-kind titles, matching the two
  existing notifications.
- `deferred` — Raising OS notifications for Task Complete and Session Error. The capability is proven working
  by this change, but turning it on for existing notifications is a behavior change on upgrade that deserves
  its own default-state decision.
- `declined` — Honoring the tool result's `disabledReason`. It describes the CLI's own terminal delivery.
- `declined` — Probing whether the tool is available, or surfacing its availability anywhere in the UI. The
  tool sits behind a server-side feature gate; absence is a no-op.
- `declined` — Rewriting or suppressing the tool result text in the transcript.
- `declined` — A general notification-dedupe subsystem, notification grouping, an in-app inbox, or history.
- `declined` — Any Codex or other-adapter equivalent. No counterpart tool exists.
- `declined` — The sibling scheduling and remote tools (wakeup, cron, remote trigger) that ship in the same
  CLI release wave.
- `platform` — The CLI's internal `os_notification` event and its `Notification` hook event. Neither is
  observable on the stream Mainframe consumes; a hook transport is separate work.
- `platform` — Any change inside the mobile submodule, the mobile push transport, the device-registration
  flow, or the desktop-active staleness window. The existing transport already delivers this.

## Edge cases

- **Message missing, empty, whitespace-only, or not a string** — no notification. The session continues, the
  stream is not aborted, and nothing is surfaced to the user as an error.
- **Unknown or absent `status` on the input** — treated the same as a valid call; only the message matters.
- **Unknown `disabledReason` variant, or a result missing every optional field** — irrelevant; the
  notification already fired on the call.
- **No result ever arrives** (session killed between call and result) — the notification stands, and the
  transcript shows the call without a result, the same as any interrupted tool.
- **Message longer than the body limit** — truncated with an ellipsis, never dropped, in every channel.
- **Two desktop windows or clients connected** — each raises its own OS notification; deduplication happens at
  the source, so each client still sees one event per call.
- **Desktop client running with OS notification permission denied** — the unread mark still happens; the push
  is not resurrected as a fallback, because desktop-active suppression is decided server-side and cannot see
  the OS permission state.
- **The call happens inside a subagent's transcript** — treated identically; it belongs to the session.
- **The tool is absent from the account's tool list** — no call arrives, no code path runs, nothing is logged.
- **Toggle flipped mid-session** — the next call honors the new value.

## Acceptance criteria

1. A Claude session whose stream carries an attention-tool call with message `M`, with the toggle on, causes
   the daemon to emit exactly one chat notification for that chat whose body is `M` (or `M` truncated with a
   trailing ellipsis when it exceeds the existing 200-character notification body limit). Observable on the
   daemon WebSocket stream.
2. That notification is emitted when the tool result reports `disabledReason` of `user_present`, `config_off`,
   or `no_transport`, when it reports no `disabledReason`, and when no result ever arrives.
3. A running desktop client raises exactly one OS notification per such call, titled "Claude needs your
   attention", body equal to the notification body from AC 1.
4. Regression: a Task Complete and a Session Error notification raise no OS notification, and their existing
   unread-mark and push behavior is unchanged.
5. With no desktop client active, a registered mobile device receives exactly one push with the same title and
   body; with a desktop client active, no push is sent.
6. With the toggle off, the same tool call produces no chat-notification event, no OS notification, no push,
   no error response, and no `warn`/`error` log line.
7. Two calls with identical message text in one session less than 60 seconds apart produce one notification;
   the same text more than 60 seconds apart produces two; two different texts back to back produce two; the
   same text in two different sessions produces two.
8. A call whose input has no `message`, an empty or whitespace-only `message`, a non-string `message`, or an
   unrecognized `status` produces no notification, and the session's stream continues to completion.
9. The tool call appears in the transcript as a tool card whose body is the message; when a result arrives,
   the displayed result text is byte-identical to what the CLI wrote.
10. A recorded session containing no attention-tool call emits the same event sequence as before the change.
11. The notifications settings pane renders the new switch in the Chat group with `data-testid`
    `settings-notify-attention-request-toggle`, checked by default. Toggling it sends a leaf-only patch
    `{ notifications: { chat: { attentionRequest: false } } }`, receives the `ok` envelope, and the value
    survives a reload.
12. The settings endpoint rejects a non-boolean `notifications.chat.attentionRequest` with the `fail` envelope
    and leaves the stored configuration unchanged.
13. `attentionRequest` exists with default `true` in both the shared TypeScript notification config and the
    Rust daemon's notification config, and a stored configuration written before this change (no
    `attentionRequest` key) loads with the value `true` without a migration step.
14. Rust daemon tests cover: tool call → notification mapping, the toggle-off path, the dedupe window
    (inside and outside), and every malformed-input case in AC 8. UI tests cover the new settings switch and
    the transcript card. All pass.
15. The branch carries a changeset.

## Decisions

- **D1 — `notify()` is wired for this notification only, not for every chat notification.** `hard-to-reverse`
  — user-approved design direction (2026-07-29), overriding the brief's "generic" recommendation. Turning it
  on for Task Complete and Session Error is a silent behavior change on upgrade; it gets its own todo.
- **D2 — The chat-notification contract gains an additive discriminator so a client can tell an attention
  request from Task Complete and Session Error.** `hard-to-reverse` — the event carries only chat id, title,
  body, and a success/error level today, which is not enough to satisfy D1 without matching on title text.
  The daemon contract is co-owned with the mobile submodule, so the field must be additive and optional.
  Flagged here because D1 is not implementable without it. **Brief-vs-code conflict:** the brief said "reuse
  the event rather than introducing a parallel event type" — that still holds, but reuse alone is not enough.
- **D3 — Settings leaf is `attentionRequest`, a boolean in the existing `chat` group, defaulting on.**
  `hard-to-reverse` — persisted config key; renaming it later strands stored values. From the design
  direction; it is a session-scoped event like task-complete, not a permission prompt.
- **D4 — Notification title is the fixed string "Claude needs your attention", not the session name.**
  `reversible` — matches the event-kind titling the two existing notifications use. **Brief-vs-code conflict:**
  the brief said the title "identifies the session (consistent with how Task Complete and Session Error title
  theirs)", but those title by event kind and carry the session only as an id. Session naming is deferred.
- **D5 — Forward on the tool call, not the tool result.** `reversible` — from the brief. The result adds a
  round trip and nothing else, and a call whose session dies before the result still deserves the notification.
- **D6 — `disabledReason` is ignored entirely, including `user_present`.** `reversible` — from the brief. It
  describes a terminal Mainframe does not own.
- **D7 — Dedupe window is 60 seconds, keyed on session plus exact message text.** `reversible` — the brief
  asked for "order of a minute"; a concrete number is testable. Exact-text matching keeps it a local
  suppression rather than a dedupe subsystem.
- **D8 — Deduplication happens once at the source, not per client.** `reversible` — every connected client
  then agrees on what fired, and two desktop windows each raising their own OS banner stays correct.
- **D9 — The tool renders as a normal tool card, not a marker pill, and is absent from the hidden and
  progress display categories.** `reversible` — from the design direction. Its sibling schedule/cron tools use
  centered marker pills, but those carry a status line, whereas this one carries a message the user must read.
- **D10 — The message is truncated to the existing 200-character notification body limit rather than getting
  its own limit.** `reversible` — the tool's message is expected under ~200 characters anyway, and one limit
  is easier to reason about than two.
- **D11 — No fallback to mobile push when the desktop client's OS notification permission is denied.**
  `reversible` — the suppression decision is server-side and cannot observe the OS permission state.
  Detecting it would need a new client→daemon signal, which is not worth it here.
- **D12 — Tool absence behind the server-side feature gate is an unobserved no-op; nothing probes for it.**
  `reversible` — from the brief. A probe would add a failure mode where today there is none.
