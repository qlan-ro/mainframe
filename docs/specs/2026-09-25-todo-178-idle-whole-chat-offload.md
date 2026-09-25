# Idle whole-chat offload (2h) with transcript cold-reload

Todo #178. Source: the todo's `## Agent Brief` and the 2026-05-15 brainstorm notes.
The brief predates the Node daemon's removal and the ACP-facade renderer rewrite
(todo #350). Its claims were re-checked against the branch, and the
contradictions are recorded in `## Decisions`.

## Problem

After a Claude chat has been idle for two hours, Mainframe stops its CLI process.
The chat's history stays in memory in two places: the daemon's message cache
(capped at 50 chats) and the desktop renderer, which keeps a controller and a
converted message graph for every thread visited since launch, with no cap. A
user who works through dozens of long sessions in a day keeps all of that memory
until they quit the app, even though every one of those transcripts is already
on disk in the CLI's session JSONL.

The fix treats "idle for two hours" as one state for the whole chat, called
offloaded. The CLI process, the daemon's cached history, and the renderer's graph
are all released at the same moment. When the user opens the chat again, its
history is rebuilt from the transcript. The chat row stays in the sidebar and
opens like any other chat.

## Behavior

**Offloading.** Every scan (existing cadence: every 5 minutes, 2-hour
threshold), the daemon looks for chats whose CLI process is running and whose
last CLI activity is more than 2 hours old. It offloads each one that has no
pending permission request. Offloading does four things together:

1. The CLI process is stopped. The chat record and its CLI session id are kept.
2. The daemon drops its cached history for the chat.
3. The chat enters the offloaded state. It behaves exactly like a chat that has
   not been opened since the daemon started.
4. The daemon broadcasts `chat.offloaded` carrying the chat id to every connected
   client, whether or not the client is subscribed to that chat.

A chat with one or more pending permission requests is never offloaded, however
long it has been idle. Its process, cache, and renderer graph stay as they are.
This changes one thing from today: such a chat also keeps its CLI process. Chats
whose adapter does not report CLI activity (every adapter except Claude today)
are never offloaded, which matches the scanner's current behavior.

**Renderer on `chat.offloaded`.**

- If the chat is not on screen (not the focused thread, not in a split zone),
  the renderer releases the chat's controller and message graph immediately.
- If the chat is on screen, it stays as it is, so the transcript does not
  vanish while someone is reading it. The renderer releases it when the user
  navigates away from it.
- The sidebar row does not change: same position, title, status, unread badge,
  and pin. It can still be clicked, renamed, pinned, tagged, archived, and
  opened in a session tab or split zone.
- Unsent composer text and attachments in an offloaded chat survive the release.
  Reopening the chat shows them again.

**Reopening an offloaded chat.** Opening the chat from the sidebar, a session
tab, or a split zone does not start a CLI process. The thread shows a spinner
centered in the empty transcript area. There is no skeleton and no progress
text. Meanwhile the daemon rebuilds the history from the chat's session JSONL
through the same pipeline that loads any chat after a daemon restart. When the
history arrives, the spinner is replaced by the full transcript, scrolled to the
bottom. The composer stays usable while the spinner shows.

The spinner is not specific to offload. Any history load of a thread that has
no messages yet shows it, including the first open after a daemon restart.
Brand-new draft threads keep their welcome screen.

**Transcript location.** The daemon reads the transcript at the session file
path recorded for the chat. If that file does not exist, it falls back to the
path derived from the chat's working directory (worktree, else project root).
This order applies to every history load, not only reloads after offload.

**Sending after offload.** The next message the user sends to an offloaded chat
resumes the CLI session through the existing resume path. The daemon restores
the chat's full history before any new message is recorded. The transcript the
user sees after sending holds all pre-offload messages followed by the new turn.

**Idempotency and races.**

- Offloading a chat that is already offloaded does nothing and emits no event.
- Reopening a chat whose history is already loaded does not read the transcript
  again.
- Just before it acts, the offload re-checks its conditions: the chat is still
  idle past the threshold, still has no pending permission, and has no send,
  spawn, or history load in progress. If any condition fails, the chat stays
  live and no event is emitted.
- Two reopen requests that arrive together share one transcript read.

## Not Included

- Changing the 2-hour threshold or the 5-minute scan interval, or making either configurable — `declined` (brief out-of-scope).
- Offloading chats that have history loaded but no CLI process, such as chats opened after a daemon restart and never sent to. The daemon's 50-chat cache cap still bounds them, but they are not released from the renderer — `deferred`.
- Offloading Codex or other adapters. They report no CLI activity, so the scanner never selects them — `deferred`.
- Solving the leak from chats pinned forever by a pending permission — `declined` (accepted trade-off from the brainstorm).
- Reconciling renderer memory for a `chat.offloaded` event missed while the renderer was disconnected. Such a chat stays in renderer memory until the app restarts. Its data is still correct: the reconnect resume re-reads the transcript — `deferred`.
- Skeleton states, progress text, or a percentage for the reload — `declined` (brief).
- Handling `chat.offloaded` in the mobile app — `platform` (separate repository; unknown side-band event types are ignored there).
- Per-message or partial truncation of live chats (#166) — `declined` (separate feature).
- Persisting the offloaded state across daemon restarts — `declined` (a restart already leaves every chat in the equivalent state).

## Edge cases

- **Chat on screen when offloaded:** the transcript stays. The renderer releases
  it when the user navigates away. Sending from it before navigating away
  resumes normally, and the history stays complete.
- **Chat in a non-focused session tab:** it is not on screen, so it is released.
  Clicking the tab reloads it with the spinner.
- **Pending permission arrives mid-scan:** the re-check fails, and the chat is
  not offloaded.
- **User sends mid-scan:** the re-check sees the send or new activity, and the
  chat stays live.
- **Transcript deleted after offload:** reopening shows the existing
  missing-transcript recovery card. The spinner does not persist.
- **Transcript read fails (I/O error):** reopening shows the existing
  "Couldn't load this chat" banner with Retry. The spinner goes away.
- **Stored session file path is stale** (the CLI moved the transcript): the
  derived path is tried next. If neither file exists, the chat is treated as a
  missing transcript.
- **Transcript relocated to a path other than the derived one** (stored path
  valid, derived path empty): the history loads from the stored path.
- **Chat archived or deleted while offloaded:** the row follows the existing
  archive/delete flows. The event for an unknown or already released chat is a
  no-op in the renderer.
- **Daemon restart:** nothing about offload is persisted, and every chat starts
  in the equivalent state.
- **Very large transcript:** the spinner stays until the load completes. There
  is no timeout, the same as today's history load.
- **Worktree deleted while offloaded:** reopening shows the existing
  missing-directory handling. Offload adds no new behavior here.

## Acceptance criteria

1. Scanner unit test (Rust): a Claude chat with a spawned process, last activity
   more than 2 hours old, and no pending permission ends a scan with its process
   killed, no cached messages for the chat, the chat out of the live-chat
   registry, and exactly one `chat.offloaded` event carrying its `chatId`.
2. Scanner unit test: a chat that meets criterion 1 except that it has at least
   one pending permission is untouched after a scan, even at 8 hours idle. Its
   process is not killed, its cache is intact, and no event is emitted.
3. Scanner unit test: a chat idle for less than the threshold, a chat with no
   spawned process, and a chat whose session reports no activity time are all
   untouched, and no event is emitted for any of them.
4. Race unit test: when activity, a pending permission, or an in-flight
   send/spawn/load is injected between candidate selection and the offload, the
   chat stays live (process running, cache intact) and no event is emitted.
5. Idempotency unit test: running the scan twice on the same idle chat emits
   exactly one `chat.offloaded` event and kills the process once.
6. Chat-manager test (Rust): after offload, requesting the chat's display
   history returns the full pre-offload history rebuilt from the transcript,
   with the same message count and the same stable item ids as before offload.
   Two concurrent requests read the transcript only once, counted by a
   `load_history` call counter.
7. Chat-manager test: after offload, requesting history does not spawn a CLI
   process. Sending a message spawns one with the stored CLI session id (the
   resume path). The history returned after the send starts with every
   pre-offload message, followed by the new user message.
8. Transcript-location test (Rust): for a chat whose stored session file path
   exists and differs from the derived path, the history load returns that
   file's messages. When the stored path does not exist but the derived path
   does, it returns the derived file's messages.
9. Golden test (Rust): one recorded Claude session, driven through the live
   stream pipeline and through transcript cold-reload, yields the same ordered
   facade item sequence, with the same ids, roles, kinds, and content, once
   timestamps are excluded. Each divergence the test finds is either fixed in
   this work or listed in the test as a named exception that links a follow-up
   todo.
10. Wire contract: `chat.offloaded` with `{ chatId: string }` is in the Rust
    daemon event enum and in the shared TypeScript `DaemonEvent` union. A new
    fixture passes the existing daemon-event round-trip test. The event is in
    the connection-global set, and a websocket test shows it reaching a client
    that is not subscribed to the chat.
11. Renderer unit test: on `chat.offloaded` for a chat that is not on screen,
    the controller registry no longer holds a controller for that chat id,
    including an adopted draft alias. An event for an unknown chat id throws
    nothing and changes nothing.
12. Renderer unit test: on `chat.offloaded` for the chat that is on screen, the
    controller stays and its messages stay visible. After the user switches to
    another thread, the offloaded chat's controller is released.
13. Renderer component test: while a thread's history is loading and it has no
    messages, an element with `data-testid="chat-thread-loading"` is centered in
    the transcript area, and no skeleton is present. The element is gone once
    messages arrive, and on load error, where `chat-thread-load-error` shows
    instead. A new draft thread shows the welcome state and no loading element.
14. Renderer test: after composer text is typed in chat A, the user switches to
    chat B, and `chat.offloaded` for A is delivered, reopening A shows the same
    composer text.
15. Live QA against the running app (Tauri or browser test harness). Restart
    the daemon, which leaves every chat in the state offload produces, so no
    test-only threshold override is needed. Clicking an existing Claude chat
    with history shows `chat-thread-loading` and then the full transcript. Its
    sidebar row stayed visible and clickable throughout. No Claude process for
    that session exists until a message is sent. After a message is sent, one
    process exists, and the transcript shows the old history followed by the new
    turn. The scanner-driven trigger is covered by criteria 1-5.
16. Rust tests for the new lifecycle pass under `cargo test -p mainframe-chat`
    and `-p mainframe-server`. UI tests pass with single-file vitest runs.
    `pnpm --filter @qlan-ro/mainframe-ui typecheck` passes. The PR includes a
    changeset.

## Decisions

1. **Rust daemon only; no Node-first phase and no parity step** — `reversible`. The Node daemon (`packages/core`) and the `MAINFRAME_DAEMON_IMPL` canary no longer exist. The brief's "Node-first, mirror in Rust" was written before that.
2. **New side-band event `chat.offloaded { chatId }`, delivered to every connected client** — `hard-to-reverse`. The side-band fan-out only delivers events that carry a `chatId` to clients subscribed to that chat. The renderer subscribes only the active thread, so a subscription-scoped event would never reach the chats that most need releasing.
3. **"Offloaded" means "not opened since daemon start"; there is no separate marker state** — `hard-to-reverse`. Reopen and send then reuse the well-trodden post-restart paths, and because the next send reloads history before appending, a live cache can never hold only post-offload messages.
4. **The offloaded state is not persisted (no DB column, no field on the `Chat` wire object)** — `reversible`. The brief asked to mark the record offloaded. A persisted flag would be wrong after every daemon restart, and nothing reads it. The event and the scanner tests make the transition observable.
5. **Chats with a pending permission are never offloaded, and they now keep their CLI process too** — `reversible`. This adopts the brainstorm ruling. It changes today's behavior, which kills the process of a chat blocked on a permission.
6. **Only chats with a spawned CLI process that reports activity time are candidates** — `reversible`. This keeps the brief's scanner trigger. Chats loaded without a process are left to the existing 50-chat cache cap. The resulting renderer gap is recorded under Not Included as deferred.
7. **An on-screen chat defers its renderer release until the user navigates away** — `reversible`. Blanking a transcript while the user reads it is worse than holding one graph a little longer.
8. **The loading spinner shows for any history load of an empty, non-draft thread, not only after offload** — `reversible`. The renderer cannot tell an offloaded chat from one never opened since restart, and today that load shows a blank thread.
9. **History loads resolve the transcript by stored session file path first, derived path second** — `reversible`. This adopts the brief. The code is currently inconsistent: the presence check already uses this order, but the history load uses only the derived path, and offload makes cold-reload a common path.
10. **The golden test compares the facade item sequence with timestamps excluded; each divergence is fixed or becomes a named, todo-linked exception** — `reversible`. The brief asked for "identical", which is unachievable for daemon-minted timestamps. An id-parity test already exists (`live_vs_history_id_parity.rs`), and this widens it to content.
11. **The offload re-checks its conditions just before acting and skips a chat with any in-flight send, spawn, or load** — `reversible`. This adopts the brief's race ruling. The current scanner kills without a re-check.
12. **The composer stays usable during the reload spinner** — `reversible`. The daemon single-flights the load ahead of a send, so sending early is safe.
13. **Unsent composer drafts survive a renderer release** — `reversible`. Losing typed text to a background memory policy would be a regression that users can see.
14. **The #166 "shared JSONL-read primitive" is the existing history load** — `reversible`. No separate truncate+expand JSONL reader exists in the tree, and #166 shipped as display-side tool-output truncation. Cold-reload reuses the history load that already backs post-restart opens.
15. **Threshold (2h) and scan interval (5 min) are unchanged; tests inject shorter values** — `reversible`. Both are brief out-of-scope. The scanner already takes an injected threshold and clock.
