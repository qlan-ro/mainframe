# Windowed transcript history

Spec dated 2026-10-19, written against `main` at `bf9efdcf`. No todo number.
Companion specs: the wire-protocol grammar
(`2026-08-28-todo-350-wire-protocol-payload-grammar.md`, decisions 3, 34, 36,
38, 40, 41, 42), idle offload (`2026-09-25-todo-178-idle-whole-chat-offload.md`),
compact transcript (`2026-10-02-todo-371-compact-transcript.md`).

Audit corrections (the dispatch's read-only audit, re-verified against the
tree): the controller and view-model files live under
`packages/ui/src/features/chat/controller/` and `view-model/`, not under
`runtime/` (which holds only the runtime hooks such as `chat-extras.ts`); the
in-memory `MessageCache` is capped at 50 unpinned chats with no per-chat message
cap (grammar decision 36), not uncapped; the `perf/shell-rerenders` and
`perf/enable-react-compiler` branches named in the dispatch are not on `origin`
and have no open PR at spec time, so nothing here depends on them (see Risks);
`packages/mobile` is not checked out in this worktree, so mobile impact is taken
from the API reference.

## Problem

Opening a long chat is slow because every first attach replays the whole
transcript. The client sends `session/resume {type:"start"}`, the daemon
materializes and encodes every container of the chat, diffs all of it into a
fresh per-connection state, ships it (previews and deflate shave bytes but not
item count), and the client applies every frame before it can publish one
`transcript.updated`. A 1958-item chat is tens of megabytes before compression
and thousands of frames after it. The same whole-transcript encode also runs on
every revision-cursor resume, even though a switch-back usually sends a handful
of updates.

Users only read the tail on open. T3 Code opens threads near-instantly by
loading a bounded newest window over the wire, paging older history on demand,
and virtualizing the list. Mainframe already keeps per-chat controllers warm and
resumes from an `{epoch, revision}` cursor; this spec adds the bounded window,
on-demand older pages, and decides when the list gets virtualized.

## Behavior

### Opening a chat

Opening a chat (first attach on this app session, or after an idle offload)
shows the newest window of the transcript: the newest 40 containers, extended
backward (up to 8 more) so the window starts at the user prompt that opens a
turn. A container is what the transcript renders as one message; tool activity
and subagent transcripts live inside their container, so a window never splits
a subagent from its parent or a tool call from its message. The spinner behaves
as today and disappears when the window is published, scrolled to the bottom.

The chat is fully usable from that moment: composing, sending, gates, queued
turns, context meter, compact and verbose modes, side chats, selection and
quote, copy and export of a message, fork from a loaded message.

Above the oldest loaded message the transcript shows one of three states:

- an "Earlier messages" row with a load action, while more history exists and
  no page is loading;
- a loading row while a page is in flight;
- a "Beginning of conversation" marker once the first container is loaded. A
  chat whose whole transcript fits in one window shows the marker from the
  start, and a chat with no history shows its existing empty state.

### Scrolling up

Scrolling toward the top of the loaded history loads the next older page (40
containers, snapped to a turn start the same way) when the reader comes within
one viewport height of the oldest loaded message, after a user scroll gesture.
The row's load action does the same without scrolling. One page loads at a
time; crossing the threshold again after a page lands loads the next one.
Loaded pages prepend without moving what the reader is looking at: the message
under the top of the viewport keeps its on-screen position. The bottom pin,
reading anchor, scroll-to-bottom button, and follow-at-bottom behavior are
unchanged.

Loaded pages stay loaded within a controller's life while the daemon can
resume the chat incrementally: switching tabs and back, or losing and regaining
the connection, keeps every loaded page. When the daemon cannot resume
incrementally (see "Returning to the newest window"), the transcript returns to
the newest window.

Older pages arrive with the same result previews a full replay would use: tool
results older than the newest 20 containers are 2 KB previews, expandable on
demand as today. Edits the daemon made to a container while it was not loaded
are reflected when its page loads; once loaded, a container receives live
updates like any other. Live progress of a background subagent whose parent
message is not loaded is not shown until its page loads; a permission request
it raises is still delivered and answerable.

### Find in chat

Find always searches the whole transcript, whether or not its older part is
loaded. The count keeps today's "1/57" format and covers the whole chat; there
is no partial count and no action to load more. The search scope is the prose
of the chat's top-level user and assistant messages (including plan, agent-sent
and review-comment prompts), with capture blocks and reference lines removed
the way the transcript removes them, in both verbose and compact mode. System
and error notices, provider-switch dividers, reasoning text, subagent
transcripts, tool inputs and outputs, result previews, and collapsed card
bodies are not searched. Matching is case-insensitive substring matching on
the message's text, counted per occurrence (overlapping hits count
separately, as today), in transcript order.

After a search the active match is the newest match at or above the bottom of
the viewport; typing never loads history. Stepping to a match scrolls to it
and highlights it as today. Stepping to a match above the loaded history first
loads everything from the oldest loaded message down to that match in one
step, so the loaded history stays contiguous; the find bar shows a loading
state until the match is on screen. When the rendered message shows the same
number of hits as the search counted for it, the matching hit is highlighted;
otherwise (markdown syntax, a hit inside link or code-fence syntax) the
message is scrolled into view and outlined, without a character-range
highlight, and still counts. A match in a clamped long prompt expands the
prompt. In compact mode, stepping to a match inside a closed turn opens that
turn.

Typing re-runs the search after a short pause, and an answer to an older query
never replaces a newer one. While the find bar is open and the transcript
changes (a streaming turn), the count and matches refresh at most once per
pause; a page landing does not re-run the search. The active match stays on
the same occurrence when it still exists; after a return to the newest window
the active match and total are kept and the next step loads through again.
Above 2000 matches the count still reads the exact total, stepping covers the
2000 matches nearest the newest message, and the bar notes the limit.

### Jump to a message

Jumping to a message from the session panel (activity source, background task
anchor), from a subagent zone's parent link, or from find scrolls to it when it
is loaded. When it is not, the transcript loads everything from the oldest
loaded message down to that message in one step, then scrolls; the entry
shows a loading state during that time. A message that is not in the
transcript reports "Not in this transcript" and leaves the loaded history as
it was.

### Session panel activity

Entries derived from the transcript (scheduled jobs, and the anchors of
delegated and background tasks) reflect loaded history only. While more
history exists the section shows a note that earlier activity may exist, with
the same load action as the transcript's row. Delegated and background tasks
the daemon reports are listed even when their tool call is not loaded; their
anchor resolves through jump-to-message.

### Compact mode

Compact mode renders the loaded history exactly as it renders a full one.
Loading earlier messages changes nothing about turns that were already fully
loaded: their rows, merge runs, and open/closed state stay as they were. When a turn's prompt is more than 8 containers behind the
window boundary, the oldest loaded turn is partial: its row's counts and
duration update when its earlier containers load, and rows of other turns are
unchanged.

### Returning to the newest window

The transcript returns to the newest window, scrolled to the bottom, with
loaded pages dropped, when: the daemon reports that its view of the chat
changed underneath (a resync), the transcript is cleared, the chat was
idle-offloaded and reopened, or the next switch-back or reconnect after a
compaction, a daemon restart, a history rewrite the daemon cannot express
incrementally (such as a removed tool call), or a long absence (the daemon
keeps incremental resume state for the 32 most recently active chats). A
provider switch in place does not reset the window.

### Latency targets

Measured on the reference transcript (the e2e long-chat fixture: at least 500
containers and 2000 items, whose newest 20 containers hold at least 10 tool
results of 32 KB or more, and whose full replay exceeds 20 MB uncompressed),
from the session-row click to the spinner disappearing with the newest window
painted, p95 of 10 runs on the CI runner class used for e2e. Each run starts a
fresh daemon, so every measured open includes the chat's one-time revision-log
seed (D7); the in-memory row warms the chat's history with a prior read before
the click, and the JSONL row starts with no history snapshot on disk:

| Scenario | Target |
|---|---|
| Open, daemon already holds the chat in memory | 400 ms |
| Open, daemon parses the JSONL transcript (no history snapshot on disk) | 400 ms above the daemon's logged history-load time |
| Switch back to a loaded chat (incremental resume) | 150 ms |
| One older page landing after the threshold | 300 ms |
| Bytes on the wire for the open, uncompressed | 3 MB, and under 10% of the full replay |

The Phase 2 PR records today's full-replay figures for the same scenarios next
to the measured results; the gate is criterion 21.

## Not Included

- `platform` Mobile. It reads `GET /api/chats/{id}/messages`, which stays the
  full transcript. Windowing is an opt-in facade capability; mobile adopts it in
  its own facade migration.
- `deferred` Paging on the REST messages route and on the MCP `chat_read` tool.
- `deferred` Searching reasoning text, subagent transcripts, tool inputs and
  outputs, previews, and collapsed card bodies. Find's scope stays the
  top-level rendered prose (compact spec, deferred hidden-output indexing);
  subagent text is searched today only while its zone is mounted, and the
  daemon count must not include what the user cannot step to.
- `deferred` Lazy history parsing on the daemon (reading only the tail of a
  JSONL transcript). The daemon still loads and projects the whole raw
  transcript; this spec bounds what it encodes and sends.
- `deferred` Moving the chat revision log's one-time full seed off the resume
  reply path: Phase 2 does it only if Phase 1a's measurement exceeds 150 ms on
  the reference transcript (open question 2).
- `deferred` Restoring loaded pages after a return to the newest window.
- `declined` Unloading pages the reader scrolled away from. Loaded history only
  grows within a controller's life; the idle offload already releases whole
  chats.
- `declined` Client-side persisted transcript snapshots across app restarts (T3's
  item (a)). The daemon stays the single source of truth; warm controllers and
  revision cursors already cover switch-back.
- `declined` Changing the preview byte limit, the 20-container full-result rule,
  or the 256-update batch size.
- `declined` Persisting the window floor or loaded page count across restarts.

## Edge cases

- The turn-start snap is bounded: the window extends backward at most 8
  containers looking for a user prompt. Beyond that the window starts at the
  plain container boundary, the oldest loaded turn is partial, and the row
  above still offers earlier messages.
- Queued prompts and the streaming overlay always belong to the newest
  containers, so they are always in the window. An open permission gate is
  redelivered on resume regardless of which container its tool call belongs
  to.
- A page request whose `before` is not the connection's current floor (a page
  queued behind a replay that reset the floor, a page for a session the
  connection is not attached to, a second page in flight) returns no items with
  a stale marker and leaves the floor unchanged; the client re-reads its floor
  and retries once if it still wants the page.
- A live revision to a container older than the connection's floor sends
  nothing to that connection. Any revision that renumbers containers below the
  floor (a full rebuild, or a suffix rebuild that inserts or removes an older
  container) is checked against the floor container's identity; on a mismatch
  the connection gets a resync.
- A session attached by prompt or cancel before any resume on a windowed
  connection receives no item older than the newest window and never receives
  creates for containers it did not load. If the client does not hold a
  container in that window, a later change to it recovers through the existing
  needs-replay path.
- Two connections (or two clients) on one chat each have their own floor; one
  loading pages never changes what the other receives.
- A page landing while the reader is pinned to the bottom (possible only via
  the explicit load action in a short chat) keeps the pin.
- A prepended user message is never fed to the optimistic-send reconciler: an
  older prompt with the same text as a pending send must not clear it.
- Prepended items with no timestamp of their own never show a "now" mount
  time; their displayed time is never later than the oldest item already held.
- "Fork from message" is offered on a loaded message; the "first user message"
  check treats unloaded earlier history as existing, and the provider-switch
  segment check falls back to the daemon's own refusal when the deciding
  divider is not loaded.
- A legacy client that does not opt in gets today's full replay byte for byte.
  A new client against a daemon without the capability sees no window meta and
  behaves as if the whole transcript were loaded (beginning marker from the
  start, no page loads).
- A find query with no match anywhere reads "0/0". A match inside a message
  that was loaded between the search and the step is highlighted directly, with
  no extra load; a load-through whose target is already loaded returns nothing
  and changes nothing.
- A load-through whose target is below the loaded history returns the whole
  gap in one response, however large; the request is only ever issued for a
  known target the user chose (a match or a jump). A load-through target the
  daemon no longer finds returns the stale marker; find re-runs its query, and
  a jump reports "Not in this transcript".
- Search works on any connection, windowed or not, and on a chat the daemon has
  not loaded yet (it loads the history first, as a resume would). A client on a
  daemon without search falls back to searching the loaded history in the
  rendered transcript as today.

## Acceptance criteria

Phase 1a (daemon and protocol):

1. `initialize` from a connection sending `_meta["_mainframe.dev"].windowedHistory: true` together with the `revisionCursors`, `replayComplete` and `itemCreationMarkers` prerequisites (Protocol) is windowed; a connection that does not opt in, or opts in without the prerequisites, produces a byte-identical `session/resume` exchange to today for start, item and revision cursors (existing resume and hub test suites pass unchanged). `windowedHistory: true` is advertised to every connection like the other capabilities.
2. A windowed `session/resume {type:"start"}` on a fixture of 120 containers replays exactly the newest 40 containers extended backward to the nearest user-prompt container (at most 8 further), every item carrying the creation marker, followed by the trailing `state_update`, gate, `queue_state`, and `replay_complete` in today's order. The reply's `history` meta carries `hasMore: true` and `floorItemId` equal to the first replayed item's id; `itemCount` equals the number of replayed items. Omitting `window.containers` uses 40; values are clamped to 1..200.
3. A windowed start replay on a transcript of 12 containers replays all of them with `hasMore: false` and `floorItemId` equal to the first item's id; an empty transcript replays nothing with `itemCount: 0`, `hasMore: false`, and no `floorItemId`.
4. `_mainframe.dev/history_page {sessionId, before: <floorItemId>, containers: 40}` returns the 40 containers preceding the floor, snapped to a turn start, in transcript order as creation-marked updates (plain `updates`, or `batches` in the `replay_batch` payload shape when the connection opted into `compressedReplay`), plus `hasMore` and the new `floorItemId`. `containers` is clamped to 1..200 and defaults to 40. With `untilItemId` instead of `containers`, the page runs from the floor down to and including the container holding that item, snapped to a turn start, with no container clamp; a fixture match 300 containers below the floor loads in one response and leaves the loaded history contiguous. Result previews apply with the same 20-container rule as a full replay. A `before` that is not the connection's current floor for that session (unknown id, a floor already reset by a later replay, a session the connection is not attached to, or a page already in flight) returns no items with `stale: true` and leaves the floor unchanged, and so does an `untilItemId` the daemon does not find; an `untilItemId` at or after `before` returns no items with the floor and `hasMore` unchanged and no stale marker. Malformed params return the facade's standard invalid-params error; a connection that did not opt in gets method-not-found.
4a. `_mainframe.dev/history_search {sessionId, query}` returns `total` (exact occurrence count over the whole transcript) and `matches` in transcript order, each `{containerId, itemId, occurrence}` where `containerId` is a top-level rendered message id and `occurrence` is the 0-based index of the hit among the item's text blocks concatenated in order, overlapping hits counted separately; when `total` exceeds 2000, `matches` holds the 2000 nearest the newest message and `truncated: true`. Matching is case-insensitive substring over the text blocks of top-level user and assistant message items, excluding system and error containers, provider-switch markers, thoughts, items with `parentToolCallId`, tool content and previews, after the same capture-block and reference-line stripping the renderer applies; an empty query returns `total: 0`. It works on a connection that did not opt into `windowedHistory`, loads a cold chat's history first, and returns invalid-params on malformed input. `historySearch: true` is advertised in the capabilities. A fixture with the query inside a tool result, reasoning text, a system notice, a subagent message, and a capture block yields `total: 0`; a fixture with "aaa" against query "aa" yields `total: 2`.
5. After a page is delivered, a live revision to a container inside that page reaches the connection as a delta (not a full create); a live revision to a container still older than the floor emits no frame to that connection; a suffix rebuild that inserts or removes a container below the floor never clears or creates an item in a container the client holds; a live re-encode of an unchanged previewed page tool call emits nothing; a gate raised by a tool call in a container below the floor is still delivered; the same revisions reach a full-replay connection on the same chat as today. Covered by hub tests.
6. A revision-cursor resume carrying `window.floorItemId` replays only changes to containers at or after the floor plus new tail containers, and echoes the floor and `hasMore` in `history` meta. An unknown floor id, an unknown epoch, or a revision outside the retained range falls back to a fresh newest window with `fullReplay: true`.
7. On a windowed resume, the daemon encodes and diffs only the connection's range (the newest window on a start resume; floor to tail on a revision-cursor resume); a test asserts the number of encoded containers equals that range on a 120-container fixture, except on the chat's first opted-in resume while its revision log is unseeded (D7), whose full encode is timed and logged. A renumbering revision whose container at the floor no longer matches the held one raises `_mainframe.dev/resync` to that connection only, without rotating the chat's epoch, and emits no further update for that session to that connection until it resumes.
8. A `session/prompt` or `session/cancel` on a fresh windowed connection before any resume produces no create for any container outside the newest window; a later change to a newest-window container the client does not hold recovers through the existing bounded `needs-replay` path.
9. New wire shapes (`windowedHistory` capability and opt-in key, `window` request meta, `history` reply meta, `history_page` params and result including `untilItemId`, `historySearch` capability, `history_search` params and result) are defined once in `packages/types` with Zod schemas and mirrored as serde types in `mainframe-types`, with fixture-pinned examples like the existing extension types. `docs/API-REFERENCE.md` documents the capability, the meta, and the request. The Phase 1a PR records the one-time revision-log seed time on the reference transcript.

Phase 1b (desktop client):

10. The desktop client opts in. Opening the reference transcript in the e2e suite shows the newest window with the "Earlier messages" row above it, the viewport scrolled to the bottom, and `chat-thread-loading` detached with at least one message rendered.
11. Scrolling up to within one viewport height of the oldest loaded message after a user scroll gesture loads one page; the message that was under the top edge of the viewport stays within 2 CSS pixels of its position when the page lands, with native scroll anchoring disabled on the transcript viewport for the test, and the same check passes in a Tauri/WebKit live-QA run recorded in the PR; crossing the threshold again loads the next page; reaching the first container shows "Beginning of conversation" and no further request is made. The load action on the row loads a page without scrolling.
12. Loaded pages survive switching to another session tab and back (incremental resume keeps the floor; no page re-request) and a facade reconnect mid-stream. A resync, a transcript clear, or a resume that falls back to a full window re-establishes the tail window, and the beginning/earlier row reflects the new state.
13. A page is applied in one `transcript.updated` before any later frame for that session is processed; a delta for a page item arriving right after the page reply never triggers `needs-replay`. An unknown-id frame still routes to the existing bounded `needs-replay` resync; a page never triggers strict creation (all its items carry the marker). A stale page result causes at most one retry with the re-read floor.
14. Prepended user messages are marked reconciled without entering the optimistic-send matcher: a test sends a prompt whose text equals an older, not-yet-loaded prompt, loads that page while the send is pending, and asserts the pending survives until its own echo arrives.
15. Compact mode: a transcript of 3 loaded turns with disclosure state set on turn 2 gets a page prepended; turn 2's row identity, open state, and merged labels are unchanged (asserted by element identity), and boundary rows are keyed by message id, not array index. A window that starts mid-turn renders the partial turn, and its row's counts update when the page completing it loads.
16. Find: on the reference transcript with 57 occurrences, 50 of them above the loaded window, the count reads "N/57" as soon as the daemon answers, with N the newest match at or above the viewport bottom, and typing issues no load-through; stepping to a match above the window issues exactly one load-through request, the loaded history is contiguous afterward, and the match is highlighted in the rendered message; stepping within loaded history issues no request. Typing three characters within the debounce window issues one search; an answer to a superseded query is discarded (asserted with reordered responses); a page landing issues no search. While a turn streams a new occurrence into the tail, the total increments at most once per debounce interval and the active match keeps its occurrence. A message whose rendered hit count differs from the daemon's (fixture: query hitting link syntax) is counted, scrolled to, and outlined without a range highlight; a clamped prompt expands on step; in compact mode a match inside a closed turn opens the turn on step. With 2500 occurrences the count reads "N/2500", stepping covers the 2000 nearest the newest message, and the limit note is shown. On a daemon without `historySearch`, find searches the loaded rendered transcript as today. Existing find tests pass.
17. Jump from the session panel to a message outside the loaded history issues exactly one load-through request, leaves the loaded history contiguous, and scrolls the message into view; a target the daemon does not find reports "Not in this transcript" with no change to the loaded history. A subagent zone whose parent Task is not loaded shows the same loading state and resolves the same way.
18. Session panel: on a fixture with a scheduled job created before the window, the Activity section does not list it until its page loads and shows the earlier-activity note while `hasMore` is true; the note's action loads a page; a background command task whose tool call is not loaded is still listed.
19. Fork from message: on a windowed chat with more history, the first loaded user message is forkable (the "first message" check honors `hasMore`); a fork the daemon refuses because of an unloaded provider-switch segment shows the daemon's error.
20. Every new interactive element (earlier-messages row, find loading state and limit note, jump loading state, activity note action) has an accessible name and a stable `data-testid`; the loading row uses `role="status"`. UI unit tests cover the accumulator prepend, the plane's page application and reconcile guard, the resume-cursor floor carriage, the scroll compensation, and the compact boundary keys; typecheck and lint pass; no file exceeds the repository limits.

Phase 2 (daemon copy avoidance and measurement):

21. A windowed resume on a chat with a seeded revision log copies only the window's containers out of the display snapshot; a test asserts the materialized container count equals the window size. If the Phase 1a seed time exceeded 150 ms, the seed is off the reply path and the in-memory row is re-measured. The e2e harness measures every row of the latency table at p95 of 10 runs on the reference transcript, records today's full-replay figures for the same scenarios, and records scroll frame rate, composer keypress-to-paint, and renderer heap with 400 containers loaded; every latency target is met.

Phase 3 (virtualization, only if the D13 gate triggers):

22. The transcript renders through a virtualized list that keeps the bottom pin, reading anchor, scroll-to-bottom, selection toolbar, compact disclosure anchoring, and find highlighting behaviors green in their existing tests; prepends keep the viewport anchored; 400 loaded containers scroll at or above 50 frames per second on the reference transcript in the e2e harness; `ProgressiveMessages` is retired; stepping to a find match whose row is not mounted scrolls the row into view first and highlights once it is mounted, and the match total is unaffected by what is mounted.

## Decisions

- D1 `reversible` Window unit is the container (one rendered message), with the boundary snapped backward to a user-prompt container within 8 containers. Containers already carry subagent children and tool calls, so no boundary can orphan a child; the snap bound keeps a long agentic turn from dragging a whole page in.
- D2 `reversible` Initial window and page size are 40 containers. It matches the renderer's existing 40-message first mount and doubles the 20-container full-result rule, so the window holds a full-result tail and a previewed older half.
- D3 `hard-to-reverse` Windowing is a connection-level opt-in capability `windowedHistory`, effective only with `revisionCursors`, `replayComplete` and `itemCreationMarkers`, with `itemCount` meaning "items replayed" on a windowed reply and the `history` meta, `window` meta and `history_page` shapes as contract. Follows the existing opt-in pattern so a non-opted connection is byte-identical, and the empty-refresh guard only distinguishes zero from non-zero.
- D4 `hard-to-reverse` The older page travels in the JSON-RPC response of a new `_mainframe.dev/history_page` request, not as `session/update` frames. Pages are not replays, so the client's replay FIFO, staging and `replay_complete` pairing stay untouched and a page applies as one atomic prepend.
- D5 `reversible` The daemon keeps one window floor per connection per session, moves it back as pages load, and suppresses live revisions to containers below it. Pages are built from the current snapshot, so a suppressed edit is delivered when its container loads instead of as a full create for an item the client never asked for.
- D6 `reversible` Any revision that renumbers containers below the floor is checked against the floor container's identity, and a mismatch is a connection-scoped resync without an epoch rotation. Position-based diffing cannot tell a shifted floor from a changed one, and only the mismatched connection needs to start over.
- D7 `reversible` The chat revision log stays a full-transcript, per-chat structure and keeps its one-time full seed on a chat's first opted-in resume after daemon start, after its log is evicted from the 32-chat LRU, or after an epoch rotation not followed by a live revision. Every later resume encodes only the window; moving the seed is gated on measurement (open question 2).
- D8 `reversible` A page whose `before` is not the connection's current floor is stale and leaves the floor unchanged. Pages queue behind replays on the session FIFO, and serving a non-adjacent page would open a gap the client does not hold.
- D9 `hard-to-reverse` A revision-cursor resume carries the client's floor item id, not a position. Positions shift under rebuilds and compaction; an id resolves or falls back to a full window exactly like the item cursor already does.
- D10 `reversible` Pages load one at a time on a scroll threshold after a user gesture, with an explicit row as fallback, and never chain automatically. Auto-chaining would reload a whole transcript for a reader who flicks to the top.
- D11 `hard-to-reverse` Find searches the whole transcript on the daemon through `_mainframe.dev/history_search`, scoped to top-level user and assistant prose after renderer-equivalent stripping (no system, error, divider, reasoning, subagent or tool text), with exact totals, `occurrence` as the hit index within an item, a 2000-match cap nearest the newest message, client-side debounce and stale-answer discard, the active match nearest the viewport, and highlighting by matching the item's rendered hit count (outline-only otherwise). The user rejected partial counts; a scope the renderer can reproduce is what keeps the daemon count and the on-screen highlights consistent, and the request shape becomes contract once the client ships on it.
- D12 `reversible` Jump-to-message and find both load through to a known target in one `history_page` request with `untilItemId`, replacing the 10-page bound and its "bound hit" state. The target id is known in both cases, so one contiguous load is simpler and faster than paging, and a stale target is the only failure.
- D13 `reversible` Virtualization is Phase 3 and ships only if the Phase 2 measurement shows 400 loaded containers scrolling below 50 fps or composer keypress-to-paint above 100 ms on the reference transcript. Windowing alone removes the open-latency problem, while virtualization touches every scroll-dependent behavior; the chosen path if the gate triggers is in the Virtualization section.
- D14 `reversible` Phase 1a ships dark: no client opts in until Phase 1b, so the daemon change merges independently and legacy behavior is exercised by every existing test.
- D15 `reversible` The daemon still loads and projects the whole raw transcript. Lazy tail parsing is a different, adapter-specific project, and the in-memory cache plus on-disk snapshot already bound the repeat cost.
- D16 `reversible` Loaded pages are never unloaded within a controller's life except when the transcript returns to the newest window (resync, clear, or fallback replay; D17), and nothing about the window persists across restarts. Unloading reintroduces every partial-history problem mid-session.
- D17 `reversible` A resync, clear, or fallback replay lands the reader at the newest window and drops loaded pages. Restoring pages to the previous floor is deferred because these cases are rare and mostly happen on open.
- D18 `reversible` Prepended user items are marked reconciled without entering the optimistic-send matcher, and prepended items never receive a "now" mount time. Both extend existing rules (R3.3, `firstSeenAt`) to a second creation path.
- D19 `reversible` Transcript-derived Activity entries reflect loaded history with an earlier-activity note. Rebuilding them from a daemon-side index is a separate feature.
- D20 `reversible` Mobile and the REST messages route are untouched (mobile is `platform`, REST paging is `deferred`). Windowing is additive and opt-in on the facade, so the mobile repository migrates on its own schedule.

## Protocol

All additions live under `_mainframe.dev`; nothing in the pinned ACP v2 surface changes.

- Capability: `windowedHistory: true` in the `initialize` response's `MainframeCapabilities`, advertised to every connection like the existing flags. Opt-in key on the `initialize` request: `_meta["_mainframe.dev"].windowedHistory: true`. The opt-in takes effect only together with `revisionCursors` opted in and `replayComplete` and `itemCreationMarkers` advertised; otherwise the connection gets today's full replay and `history_page` returns method-not-found.
- `session/resume` request meta: `_meta["_mainframe.dev"].window` with `containers` (default 40, clamped 1..200) for a start replay and `floorItemId` for a revision-cursor replay. An item cursor ignores `window`. On a windowed connection a start resume without `window` uses the default of 40, and a revision-cursor resume without `floorItemId` falls back to a fresh newest window with `fullReplay: true`.
- `session/resume` reply meta gains `history: { hasMore, floorItemId }`. `itemCount` is the number of items replayed on a windowed connection; `fullReplay` and `cursor` keep their meanings. A `fullReplay` on a windowed connection means "replace everything you hold with this newest window".
- `_mainframe.dev/history_page` request: `{ sessionId, before, containers?, untilItemId? }`. Result: `{ updates?, batches?, hasMore, floorItemId, stale? }`. `updates` is the page as creation-marked `session/update` payloads in transcript order; `batches` replaces it on a `compressedReplay` connection with the `replay_batch` payload shape. With `untilItemId` the page runs from `before` down to and including that item's top-level container (snapped to a turn start, no clamp) and `containers` is ignored; a target already at or after `before` returns no items and changes nothing. `stale: true` with no items means `before` is not the connection's current floor for that session, or `untilItemId` is unknown. The daemon lowers the connection's floor before replying, so a page's containers receive live deltas from that moment.
- `_mainframe.dev/history_search` request: `{ sessionId, query }`. Result: `{ total, matches: [{ containerId, itemId, occurrence }], truncated? }`, matches in transcript order; `containerId` is the top-level container (the rendered message id), `occurrence` the 0-based hit index among the item's text blocks concatenated in order with overlapping hits counted separately; at most 2000 matches, the ones nearest the newest message when truncated. Available to every connection regardless of `windowedHistory`; advertised as `historySearch: true`. Stateless: the daemon keeps no query, so there is nothing to cancel; the client discards answers to superseded queries by its own request ordering.
- `_mainframe.dev/cursor` notifications, `replay_complete`, `queue_state`, gates, and the resume ordering are unchanged.
- Back-compat matrix: old client / new daemon: no opt-in, byte-identical. New client / old daemon: no `windowedHistory` capability, the client sends no `window` meta and treats the replay as the whole transcript; no `historySearch` capability, find searches the loaded rendered transcript as today. New / new: windowed, daemon search.

## Daemon

- Resume on a windowed connection: load and project history as today; select the window by container position with the turn-start snap; encode, preview, diff, and seed only that slice; seed the connection's diff state so its container positions align with the chat's full projection and record the floor. Work is proportional to the window, except the raw load/projection (cached) and the revision-log seed cases in D7.
- Attach by prompt or cancel on a windowed connection: the session's stream is seeded with the newest window (same selection as a start resume) rather than left unseeded, so its first revision never creates the whole transcript (criterion 8).
- Live fan-out: a revision touching only containers below the connection's floor emits nothing to it; one touching the floor or later is diffed as today. Any revision that renumbers containers below the floor (full rebuild or suffix rebuild) validates the floor container's first item id and raises a connection-scoped `resync` on mismatch, without rotating the epoch (D6).
- Revision-cursor resume: plan against the chat's full log as today, but only compare and emit containers at or after the requested floor; new tail containers are always included; an unknown floor falls back to a fresh newest window.
- `history_page`: verify `before` equals the connection's floor for that session; resolve it to a container position; select the preceding page with the snap; encode and preview it; seed it into the connection's state and lower the floor atomically with respect to live fan-out for that session (the same guarantee `reset_session` gives a resume); then reply. The hub's per-session ordering already serializes resume, prompt, and cancel; the page joins that order. Previewed ids from a page join the connection's preview set so later re-encodes stay trimmed.
- `history_page` with `untilItemId`: the same path with the page range resolved from the target's container instead of a count; the response may be large, which is accepted because the request is only issued for a user-chosen target.
- `history_search`: a linear scan over the chat's cached display messages (loading them first on a cold chat, through the same single-flight path a resume uses), matching the text blocks of top-level user and assistant message items (system, error and divider containers, thoughts, and subagent children excluded) after stripping capture blocks and reference lines with the shared marker grammar the renderer uses, case-insensitive, per overlapping occurrence, in transcript order; the scan runs off the socket loop like a resume and holds no per-connection state. Total is counted over everything; the match list keeps the 2000 nearest the tail.
- Phase 2: the snapshot read for a windowed resume copies only the window's containers when the revision log is already seeded.
- Multi-segment chats, queued prompts, streaming overlay, previews, and compressed batches need no new rules: they operate on the encoded containers the window selects.
- Logging: every resume and page logs `chat_id`, window size, floor position, `has_more`, and encode time as structured fields; the one-time log seed logs its own duration.

## Client

- Attach: opt in at `initialize`; send `window.containers` on start replays and `window.floorItemId` on revision replays; parse `history` meta with Zod; hold `hasMore` and the floor in the controller's state and expose them to the thread through the existing extras.
- Accumulator: an ordered prepend that inserts a page's items before the current first item in one operation and returns the published list; the converter's per-container cache keeps every existing message identity across the prepend.
- Page application: the response is applied synchronously, before the next socket frame, as one `transcript.updated`; a stale result re-reads the floor and retries once; reconciled-id marking for prepended user items (D18); `firstSeenAt` never stamps "now" on prepended items.
- Thread: a top sentinel with the three states, scroll compensation on prepend, gesture gating (D10), and the retired array-index keys in `ProgressiveMessages` and the compact boundary units replaced by message-id keys so a prepend does not remount the tail. Jump and subagent-zone resolution load through to their target with one `untilItemId` page (D12). Find sends the query to the daemon (debounced, with a monotonically increasing request ordinal so a late answer to an older query is dropped), keeps the match list and total in its store, picks the newest match at or above the viewport bottom as active, re-runs at most once per debounce interval while the transcript changes (not on page landings), steps through matches by loading through when the match's container is not held, and highlights by locating the match item's rendered text parts (the renderer marks each text part with its item id, and gives plan, agent-sent and review-comment prompts the same searchable marker) and selecting the `occurrence`-th hit when the rendered hit count equals the daemon's for that item, falling back to scrolling and outlining the message otherwise; a clamped prompt expands and a closed compact turn opens on step (D11). The Activity section gets the earlier-activity note (D19). Fork availability honors `hasMore` (edge cases).
- A resync, transcript clear, or fallback replay resets `hasMore`/floor from the new reply's meta; loaded pages are discarded with the staged swap.
- Dormancy, detach, gap resume, `needs-replay` backoff, and the FIFO replay windows are untouched; a page is not a replay window.

## Virtualization

See D13. Summary of the trade: `react-virtuoso` is already pinned for the sessions sidebar and offers first-item-index prepends, start-reached callbacks, follow-output pinning, and scroll-to-index, which map directly onto paging, the bottom pin, and jump. assistant-ui's `ThreadPrimitive.MessageByIndex` (already used by `ProgressiveMessages`) renders one message by index without `ThreadPrimitive.Messages` owning the list, so a virtualized item renderer can wrap it; this is an informed default to re-verify against the pinned `@assistant-ui/react` release at build time per the UI package's golden rule. The costs are the viewport-coupled behaviors listed in D13, the compact mode's nested scroll anchoring, the reading anchor's text-node capture (invalid when rows unmount), find highlighting (the daemon supplies the matches, but a highlight needs its row mounted, so stepping must scroll first and highlight after mount), and selection across unmounted rows. These are solvable but each is a regression surface; windowing alone removes the open-latency problem, so virtualization waits for a measured need.

## Phasing

1. Phase 1a — daemon and protocol, dark: windowed resume, `history_page` including load-through, and `history_search` (criteria 1–9, including 4a). Independent PR; mergeable on its own.
2. Phase 1b — desktop client opt-in, paging, prepend, scroll compensation, compact keys, reconcile guard, daemon-backed find, load-through jump, activity and fork semantics (criteria 10–20). Depends on 1a.
3. Phase 2 — daemon snapshot copy avoidance and the latency measurement harness in e2e (criterion 21). Can run in parallel with 1b once 1a is merged.
4. Phase 3 — virtualization, only if the D13 gate triggers (criterion 22). Separate PR after 1b and 2.

## Risks

- Position alignment between a windowed connection's diff state and the chat's full projection is the subtle part of 1a: incremental deltas can rewind and refold groups from any ordinal, and ordinals at or above the new length count as removed. A mistake shows up as wrong-container clears after a page load; hub tests must cover delta-after-page, suffix-rebuild-below-floor, and full-delta-after-page explicitly (criteria 5, 7).
- Scroll compensation on prepend: the app does its own pinning (`autoScroll={false}`), nothing sets `overflow-anchor`, the e2e suite drives Chromium (which anchors natively), and the shipped webview is WebKit. Criterion 11 therefore disables native anchoring for the test and requires a WebKit live-QA run; without both, a prepend could pass e2e and still jump in the app.
- The one-time revision-log seed (D7) still pays a full encode on more occasions than "once per daemon lifetime" (LRU eviction, epoch rotation); the Phase 1a measurement decides whether open question 2's default moves it.
- Activity entries created before the window are absent until their page loads (D19); users who rely on the panel to find old scheduled jobs will need the note's load action.
- In-flight perf work: if the React Compiler or the shell re-render changes land first, the prepend path must keep message identity stable under the compiler's memoization (the converter cache already does); if virtualization lands first, those PRs must re-verify against the virtualized viewport. Neither is a dependency.
- A page response is one JSON-RPC message; at 40 containers with previews it is bounded, but 40 image-heavy containers could be large since previews never trim images (grammar decision 41). The 200-container clamp bounds the counted case; a load-through to a target near the beginning of a long chat is unbounded by design and can approach a full replay's size. That is accepted because it only happens for a target the user chose, but if it hits socket frame limits in practice, open question 3 revisits delivery.
- Daemon search matches raw message text while the renderer highlights rendered text: markdown syntax can make an item's hit count differ between the two even after the shared capture/reference stripping. The hit-count check and outline-only fallback keep stepping and totals honest, but a query that matches mostly syntax will show more outlined messages than highlights. The stripping rules must live in one shared grammar (mirrored in Rust and TypeScript, like the other wire types) or the counts drift.
- A search on a cold chat loads its history first, so the first query on a never-opened chat pays the history load; the find bar's loading state covers it.

## Test plan

Daemon (`cargo test -p mainframe-acp`, `-p mainframe-server`, `-p mainframe-chat`):

- `mainframe-acp` resume tests: windowed start replay selection and snap (criteria 2, 3), `history` meta, `itemCount` as replayed count, previews inside a window and inside a page, compressed page batches, stale `before`, clamped and defaulted `containers`, load-through with `untilItemId` (range, snap, contiguity, unknown target, `containers` ignored), malformed params, method-not-found without opt-in; revision-cursor resume with a floor (criterion 6); encode-count assertion and seed timing log (criterion 7). New `history_page` dispatch tests alongside `resume_tests_*`.
- `mainframe-acp` search tests (criterion 4a): scope (top-level message text only; system/error/divider containers, thoughts, subagent children, tool content and previews excluded; capture blocks and reference lines stripped), case-insensitivity, overlapping per-occurrence counting and transcript order, `occurrence` across several text blocks in one item, the 2000 cap keeping the newest with `truncated` and exact `total`, empty query, malformed params, availability without `windowedHistory`, cold-chat load before search.
- `mainframe-acp` session-state tests: seeding with a floor, suppression below the floor, delta at and after the floor, suffix rebuild below the floor, full delta with matching and mismatching floor, page previews staying trimmed.
- `mainframe-server` hub tests: page seeds the stream atomically with fan-out (a revision racing the page is neither lost nor duplicated), per-connection floors, connection-scoped resync on floor mismatch without epoch rotation, prompt-attach seeding with the newest window (criterion 8), legacy connections unchanged (reuse `hub_tests_resume_race_tests_*` and `hub_tests_revision_cursor_tests` fixtures).
- `mainframe-chat`: Phase 2 range materialization test (criterion 21) next to `chat_manager_tests_resume_snapshot.rs`.
- Fixture-pinned JSON for every new wire shape in `mainframe-types`, matching the `packages/types` fixtures.

UI (`pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>`):

- Accumulator prepend and identity; plane page application, synchronous ordering and stale retry (criterion 13), reconcile guard (criterion 14), `firstSeenAt` rule; resume-cursor floor selection matrix; attachment opt-in and meta parsing.
- Thread: sentinel states, gesture gating, scroll compensation (criterion 11, in the bottom-pin test harness with native anchoring disabled), load-through jump and the not-found state (criterion 17); `ProgressiveMessages` keyed by id; compact boundary keys, disclosure stability and partial-turn update (criterion 15); find store and bar: debounce, stale-answer discard with reordered responses, exact total, active match nearest the viewport with no load on typing, step-to-unloaded match issuing one load-through, re-run cadence on streaming and none on page landing, active occurrence kept across re-runs and a return to the newest window, occurrence-to-range relocation by rendered hit count and the outline fallback, clamped-prompt expansion, compact closed-turn opening, the 2000 note, and the legacy DOM fallback without `historySearch` (criterion 16); activity note (criterion 18); fork gating (criterion 19).

E2E (`pnpm test:e2e`, mock adapter):

- A new long-chat fixture (reference transcript, tail makeup per the latency section) and a `windowed-history.spec.ts`: open shows the newest window and the earlier row; scroll-up paging with position hold; beginning marker; tab switch and back keeps pages; reconnect mid-stream keeps the window; find reports the whole-transcript total, steps to a match above the window with one load-through, and keeps the total current while a turn streams; jump from the session panel into unloaded history loads through in one request; resync lands at the newest window. The Phase 2 latency measurement runs in the same spec and reports p95 of 10 runs for every table row plus scroll fps, keypress-to-paint and heap at 400 loaded containers.
- Live QA on the Tauri build records the prepend position hold on WebKit (criterion 11).
- Existing `facade-protocol*.spec.ts`, `transcript.spec.ts`, `compact-transcript.spec.ts`, `stress-matrix.spec.ts`, and `fork-from-message.spec.ts` pass unchanged.

## Open questions (defaults chosen)

1. Window and page size. Default 40 containers (D2). Revisit if the latency table is missed or the window routinely shows fewer than 10 turns.
2. Revision-log one-time seed on the resume path. Default: keep it (D7) and record its time on the reference transcript in the Phase 1a PR; if it exceeds 150 ms, Phase 2 moves the seed off the reply path (the Not Included entry carries the same condition).
3. Page delivery in the response vs as frames. Default: response (D4). Revisit only if a single page response proves too large for the socket's frame limits in practice.
4. Search match cap (D11). Default 2000 matches with an exact total; raise, or page the match list, if real queries hit it.
5. Load-through size (D12). Default: unbounded for a user-chosen target; add a confirmation above a threshold only if the measured response for a beginning-of-chat target on the reference transcript exceeds the open-latency target by more than 5x.
6. Virtualization gate thresholds (D13): 50 fps and 100 ms keypress-to-paint at 400 loaded containers. Defaults chosen as visible-jank thresholds; adjust once Phase 2 measures the baseline.
7. Fallback replays return to the newest window rather than replaying from the client's floor (D17). Default: newest window; replaying from the floor would keep pages across daemon restarts at the cost of a larger fallback replay.
8. Mobile adoption timing. Default: none in this project (D20); the mobile repository opts in when it migrates to the facade.
