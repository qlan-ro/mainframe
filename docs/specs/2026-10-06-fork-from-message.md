# Fork from any user message

Sources: the user's rulings of 2026-10-06 (non-destructive "Fork from here" only;
no in-place rewind; no file restoration; the parent is never mutated), #343's fork
spec, and #368's Codex fork. This closes #343's deferred "Forking from an earlier
message" item. Claims were checked against `main` at `155940a`, Claude CLI 2.1.292
(`/opt/claude-code/bin/claude`), and the Codex receipts in
`docs/research/adapters/codex/CONSUMED-SURFACE.md` (CODEX-RPC-07, codex-cli
0.155.1). Two sibling specs are drafted in parallel: (a) in-chat provider switch and
(b) the MCP orchestration server. `## Compatibility` says what this spec needs from
each.

## Problem

#343's Fork branches a chat only at its current end. To retry an earlier prompt
another way, the user must scroll back, copy the prompt, fork, and hope nothing
after that prompt matters. Nothing branches from the middle. The CLIs can rewind in
place, but that destroys the line of work the user may still want.

This spec adds "Fork from here" to each user message. It creates a new chat that
holds the parent's conversation up to, but not including, that message. The
message's text waits in the new chat's composer, unsent. The parent is untouched.

## Behavior

### Where the action appears

- The action sits in a hover action bar under each sent user message in the chat
  thread: a ghost icon button with a `GitFork` glyph and the tooltip "Fork from here".
  Its test id is `chat-user-message-fork`. It sits inside the message root, which
  carries `data-message-id`.
- It is not rendered for:
  - queued messages (they keep their own queued controls);
  - temporary chats, including side chats;
  - no-project chats;
  - drafts.
  None of these can ever fork, so a disabled button on every message would be noise.
- Assistant messages get no new action. "Fork after turn k" is "fork from user message
  k+1", and the current end is #343's Fork.
- Otherwise the button is enabled, or disabled with a `Hint` naming the first failing
  reason, in this order:
  1. The adapter cannot fork: #343's copy, or the adapter's `forkUnavailableReason`.
  2. The chat has no provider session: "Nothing to fork yet".
  3. The transcript is missing: "This chat's transcript is missing".
  4. The working directory is missing: "This chat's folder is missing".
  5. The message is still sending or failed to send: "This message hasn't been sent
     yet".
  6. It is the chat's first user message: "Nothing before this message to fork".
  7. Once sibling (a) ships, the message is before the latest provider switch: "Can't
     fork from before the switch to <adapter display name>".
- A turn in flight does not disable the action. Everything before a sent message is
  already settled, so the cut is unambiguous even while the parent works or waits on
  a gate. #343's whole-chat Fork keeps its in-flight refusal.

### What the fork is

- **Fork point:** immediately before the chosen message. The fork holds every
  message the parent showed before it. It does not hold the message or anything
  after it. The daemon pins this point before it returns the chat (#343's rule), so
  later parent messages and daemon restarts cannot move it.
- **Composer prefill:** the chosen message's visible text (`visibleMessageText` of
  its text part) is placed in the fork's composer. It is not sent. Attachments and
  images are not carried.
- **Inherited:** exactly #343's list (project, adapter, model, permission mode, plan
  mode, tuning, working directory), read from the parent as it is now.
  Mainframe keeps no per-message settings history.
- **Not restored:** files. The fork runs in the parent's current working tree,
  including any edits made after the fork point.
- **Not inherited:** tags, pin, counters, unread, automation run (#343).
- **Lineage:** the generic parent reference (#343), pointing at the parent. All
  lineage UI (nesting, hover card, header link) applies unchanged.
- **Title:** `<parent title> (fork)`, with #343's rules: no stacked marker, a rename
  before the first send wins, and title generation runs on the first send.
- **History before the first send:** the parent's conversation up to the fork
  point, rendered like any resumed chat. After the first send, the fork's own
  transcript holds that same prefix.
- **Opening:** on success the fork opens exactly as #343's does: beside the parent in
  a split when the parent is on screen, and as the active thread. On failure an
  error toast shows the daemon's message, and nothing is created.

### Daemon contract

`POST /api/chats/{id}/fork` gains an optional body field. A missing body, `{}`, or
`{"fromMessageId": null}` keeps #343's whole-chat fork.
`{"fromMessageId": "<id>"}` forks before that message. The id is the chat message
id that the thread shows. The checks run in this order:

| Request | Status | Message |
| --- | --- | --- |
| Unknown field, malformed body, empty id, or an id not matching `^[A-Za-z0-9_-]{1,128}$` | 400 | Validation error |
| Unknown chat | 404 | `Not found` |
| Adapter cannot fork | 422 | #343's copy |
| Temporary, no project, no session, transcript missing, or directory missing | 409 | #343's copy |
| Message not in this chat | 404 | `Message not found` |
| Message is not a user message | 400 | `fromMessageId must name a user message` |
| Message queued, still sending, or failed | 409 | `This message hasn't been sent yet` |
| First user message | 409 | `Nothing before this message to fork` |
| Before the latest provider switch (sibling (a)) | 409 | `Can't fork from before the switch to <name>` |
| The message can't be placed in the provider transcript | 409 | The adapter's reason (see Protocol) |
| Pin or insert failure | 500 | Failure message |

### Edge cases

- **The parent is messaged, or the daemon restarts, between the fork and its first
  send.** The fork is unchanged, exactly as in #343 AC 2 and 3.
- **The parent is mid-turn, possibly on the chosen message's own turn.** The fork
  succeeds. The running turn is not in the fork, and the parent's process is not
  touched.
- **The chosen message was just sent and its transcript line is not flushed yet**
  (Claude batches writes every 100 ms). The request returns the unresolved 409.
  Retrying works.
- **Claude folded the message into a running turn** (a queued send absorbed as a
  `queued_command` attachment). It is not a turn boundary, so the request returns
  409 "This message joined a turn that was already running, so it can't be a fork
  point".
- **The message predates a clear-context restart** (plan "clear context and
  implement"). It lives in a provider session the chat no longer holds. The
  request returns the unresolved 409. This is the same class of case as sibling
  (a)'s earlier segments.
- **The cut is before a compaction.** Claude: works. The fork resumes the
  uncompacted conversation before the message, and the CLI may auto-compact on the
  fork's first turn. Codex: works, because turn ids are unaffected.
- **Fork from a message inside a fork that has run.** This works against the fork's
  own transcript. If the fork's live ids differ from its transcript's, the ordinal
  fallback in Protocol resolves them.
- **The same message is forked twice.** The result is two independent forks.
- **A slash-command message sent live.** Claude's `send_command` forces no uuid, so
  its live id is a daemon nanoid. The ordinal fallback places it.

## Protocol

### Id mapping (verified)

- **Claude:** `send_queue.rs::queued_message_metadata` mints a uuid for every send.
  `send.rs::store_user_message` stores it as the chat message id, and
  `user_payload.rs::build_user_payload` forces it as the stdin `uuid`. On cold load,
  `history_user_entry.rs` sets the id through `history_entry_helpers::id_or_nanoid`
  from the entry's `uuid`. So a user message id equals its transcript entry `uuid`,
  live and cold (#178 decision 10). The exception is
  `session_prompt.rs::send_command`, which sends no `uuid`.
- **Codex:** `session_prompt.rs::send_message` ignores `_uuid`, so live user ids are
  daemon nanoids. Cold ids are `userMessage` item ids (`history_convert.rs`).
- **UI:** a top-level message item id is the chat message id
  (`mainframe-acp/src/encoder.rs::Container::message_item_id`, ACP Decision 23).
  The id the button sends is the daemon's id.

### Resolving the cut (adapter-neutral, `mainframe-chat`)

`resolve_fork_cut(live, disk, message_id)` is pure. `live` is
`ChatManager::get_messages(parent)` and `disk` is
`ChatManager::get_messages_from_disk(parent)`. It returns the vendor id of the
chosen message:

1. Find `message_id` in `live`. Apply the not-found, not-user, unsent (metadata
   `queued`, or a client-pending or failed send), and first-message rules.
2. If `disk` has a user message with the same id, return it (the Claude common
   path).
3. Otherwise, let `k` be the message's index among sent user messages in `live`. If
   `disk` has exactly as many user messages, return `disk[k].id`. If the counts
   differ, refuse with the unresolved 409, "Couldn't find this message in the chat's
   transcript". Failing closed never forks at the wrong point.

Once sibling (a) ships, both lists are first restricted to the latest segment.

### Claude: pin a prefix snapshot

#343 already pins by copying the parent transcript into
`<fork_snapshots_dir>/<nanoid>/<parentSessionId>.jsonl` (plus `subagents/`). With a
cut, `pin_fork_point` copies only the line prefix before the first line whose
entry has all of:

- `uuid` equal to the vendor id;
- `type == "user"`;
- `isSidechain` not true;
- `isMeta` not true;
- content that is not only `tool_result` blocks.

A matching `attachment` line returns the "joined a turn" refusal. No match, or a
prefix with no chain entry (`user`, `assistant`, `system` or `attachment`), returns
`ForkPinError::PointNotFound(reason)`.

Everything downstream is #343's code, unchanged:

- spawn: `--resume <snapshot path> --fork-session` (`session_spawn.rs::append_resume_args`);
- history before the first send: `load_history_in_dir`;
- retirement and the startup sweep.

The transcript is append-only, so the prefix is the exact file state the parent had
when the message was sent. Per SESSIONS_JSONL its latest chain entry is the
message's `parentUuid`, and that is the leaf a resume picks.

**`--resume-session-at`: verified, not used.** In 2.1.292 it is a hidden option
(`hideHelp()`): "When resuming, only messages up to and including the chain entry
with <message.id> — any chain-entry UUID, typically the kept turn's last entry (use
with --resume in print mode)". The headless resume (`YF`) runs
`messages.findIndex(m => m.uuid === resumeSessionAt)`. On a miss it prints
`No message found with message.uuid of: <id>` and exits 1. On a hit it keeps
`slice(0, idx+1)`. The id is therefore a chain entry `uuid`, not the API
`message.id`. Mainframe's stream-json spawn takes that headless lane:
`V4e()` treats `!process.stdout.isTTY` as non-interactive, and the headless
prologue passes `resumeSessionAt` into `YF`. The same holds for
`--no-session-persistence` (CLAUDE-FLAG-03).

It is rejected for three reasons:

- It works on the deserialized chain, and a `compact_boundary` starts a new chain
  (`parentUuid: null`). A cut before the latest compaction is expected to miss and
  exit 1. This expectation is inferred, not live-tested.
- The display history would need a second truncation of Mainframe's own that must
  agree with the CLI's.
- It is undocumented and paired with a print-mode-only `--resume-drops-turn` guard.

It is the contingency if Gate 0 check 1 fails. Use a full snapshot plus
`--resume-session-at <message.parentUuid>`, refuse cuts before the latest
compaction, and truncate the display list at the message. `--rewind-files` exists,
and the user declined file restoration.

### Codex: pin an earlier turn

#368's `fork_pin.rs::pin_fork_point` already calls `thread/read {threadId,
includeTurns: true}` and stores `ForkSource.last_turn_id`. With a cut, it finds the
turn whose items include a `userMessage` with `id ==` the vendor id. It pins the
turn before it, which must not be `inProgress`. The first turn, or no match, returns
`PointNotFound`. The first spawn sends #368's unchanged `thread/fork {threadId,
lastTurnId}` (inclusive). The unsent fork's history uses
`history_load.rs::truncate_at_turn_cap` unchanged. Nothing falls back to
`thread/rollback`: t3code documents that paginated-history threads, which every
Codex fork is (CODEX-RPC-07), reject it.

### Gate 0: live checks before implementation

These are run with the protocol-debugger skills. Results are recorded in both
CONSUMED-SURFACE files.

1. Claude: a 3-turn session, cut before prompt 3, then a fork spawn. Asked to repeat
   the previous prompt, the model answers with prompt 2. The fork's session id
   differs from the parent's. The parent JSONL is byte-identical.
2. Claude: the same check with `/compact` run after turn 3.
3. Claude: a cut before a queued-then-dequeued prompt. A trailing `queue-operation`
   in the prefix does not auto-run anything on resume.
4. Claude and Codex: pin and fork while the parent's later turn is running in its
   own process. The parent is unaffected.
5. Codex: `lastTurnId` naming a non-last completed turn excludes every later turn.
6. Codex: on a forked (paginated) thread, `lastTurnId` naming an inherited turn is
   accepted. If it is not, the 409 reads "Can't fork from before this chat was
   forked. Fork its parent instead".

If check 4 fails for an adapter, the from-message fork keeps #343's in-flight
refusal for all adapters. The rule stays single.

### Pending live verification

The primary design is implemented without Gate 0: no authenticated Claude or
Codex CLI was available where it was built. Fixture tests cover the prefix
cut, the Codex turn choice, the chat-layer cut resolution and the REST
contract. These checks remain to be run with the protocol-debugger skills
before the CONSUMED-SURFACE rows (CLAUDE-FILE-09, CODEX-RPC-07c) can be
marked verified:

1. Claude: a 3-turn session cut before prompt 3 resumes with prompt 2 as the
   previous prompt, under a new session id, with the parent JSONL unchanged.
2. Claude: the same with `/compact` run after turn 3.
3. Claude: a cut before a queued-then-dequeued prompt; a trailing
   `queue-operation` line in the prefix does not auto-run anything on resume.
4. Claude and Codex: pin and fork while the parent's later turn runs in its
   own process; the parent is unaffected. If this fails, restore #343's
   in-flight refusal for `BeforeMessage` too.
5. Codex: `lastTurnId` naming a non-last completed turn excludes every later
   turn.
6. Codex: on a forked (paginated) thread, `lastTurnId` naming an inherited
   turn is accepted. If not, map the refusal to "Can't fork from before this
   chat was forked. Fork its parent instead".

## Data model & API changes

- **No storage migration.** `chats.pending_fork` and `ForkSource` keep their shape.
  The cut is fully encoded by what the pin returns: a prefix snapshot path, or
  `last_turn_id`.
- **`mainframe-adapter-api/src/adapter.rs`:**
  - `ForkPinRequest.cut: Option<ForkCut>`, where `ForkCut { vendor_message_id: String }`;
  - `ForkPinError::PointNotFound(String)`.
  The default `pin_fork_point` is unchanged.
- **`mainframe-chat/src/fork.rs`:**
  - `pub enum ForkPoint { Current, BeforeMessage(String) }`;
  - new `ForkChatError` variants mapped to the contract table: `MessageNotFound`
    (404), `NotAUserMessage` (400), `MessageNotSent`, `NothingBeforeMessage`,
    `ForkPointUnresolved(String)` and, with sibling (a), `BeforeProviderSwitch(String)`
    (all 409).
- **`ChatManager::fork_chat(&self, chat_id, point: ForkPoint)`.** This is the single
  entry for REST and for sibling (b).
- **REST body (`mainframe-server`):** `ForkChatBody { from_message_id: Option<String> }`
  with `#[serde(rename_all = "camelCase", deny_unknown_fields)]` and the pattern check.
  Serde is the Rust daemon's equivalent of the Zod rule.
- **`packages/types/src/chat.ts`:** `export interface ForkChatRequest { fromMessageId?: string }`.
- **UI API:** `forkChat(port, chatId, body?: ForkChatRequest)`.
- **ACP:** no new method. Forking stays REST-only (#343's ruling).

## Compatibility

**(a) Provider switch in the same chat.** For v1 the fork point must lie in the
chat's latest segment, and not on that segment's first user message. The fork's
adapter and source session are then the chat's current ones, so #343's inheritance
holds. Earlier messages are disabled with the hint above. That hint also covers the
segment's first message, because forking before it means "after the previous
provider's last turn". The handoff that opened the latest segment travels with the
fork. Sibling (a) must provide two things:

- per-message segment membership, readable by `resolve_fork_cut` and visible to the
  UI as a boundary in the message list;
- the handoff either inside the segment's provider transcript (inherited by the cut
  for free) or recorded on the segment, so `fork_chat` copies it to the fork's
  first segment.

The fork's pre-send history is that segment's rendering up to the cut. Forking into
an earlier segment is deferred. It would resume that segment's session at the cut
and carry segments 1..N-1's handoff.

**(b) MCP orchestration.** A fork tool calls `fork_chat` with
`ForkPoint::BeforeMessage(id)`. The ids are the same ones its read-chat tool
returns. Because the from-message path allows a turn in flight, an agent can branch
its own chat at an earlier prompt mid-turn. Prefill is UI-only. The agent already
has the text. Forks keep the generic parent reference, and if (b) adds a
relationship kind, these are `fork`. Messages that (b) injects into a chat are user
messages and are forkable like any other.

## Decisions

- **Not hard to reverse:** the action lives only on user messages, and the fork
  ends just before the chosen message. One entry covers every turn boundary
  except the end, which #343 covers. It also serves the main use, "retry this
  prompt differently", without rewind.
- **Not hard to reverse:** the message text is prefilled, never sent. This is the
  non-destructive counterpart of the CLI's rewind, which puts the message back
  into the input.
- **Hard to reverse:** the Claude cut is a line-prefix snapshot, not
  `--resume-session-at`. One artifact drives the resume, the pre-send display and
  restart safety. It works across compactions and uses only flags Mainframe
  already relies on. The flag stays as the documented contingency.
- **Hard to reverse:** the cut is resolved in `mainframe-chat` (id first, ordinal
  with an equal-count guard second), and adapters only translate a vendor id. One
  tested mapping covers Claude `send_command` nanoids, Codex live nanoids and forks
  of forks, and it fails closed.
- **Not hard to reverse:** no turn-in-flight refusal for the from-message path.
  Everything before a sent message is settled, and sibling (b) needs mid-turn
  forks. Gate 0 check 4 can revert this.
- **Not hard to reverse:** the action is hidden, not disabled, for chats that can
  never fork (temporary, no project, side chats). Per-message disabled buttons
  would be noise. #343's menu items stay disabled-with-reason, as they are one per
  chat.
- **Not hard to reverse:** files are not rolled back, and the tooltip does not say
  so. This is the user's ruling. A note can be added if users are surprised.
- **Not hard to reverse:** only the latest provider segment is forkable (sibling
  (a)). This keeps the fork single-provider with no new handoff logic.
- **Not hard to reverse:** no ACP method. The same reasoning as #343 applies, and
  sibling (b) calls `ChatManager` directly.

## Out of scope

- In-place rewind, `--rewind-files`, or any file restoration. `declined`
- A fork action on assistant messages. `deferred`
- Carrying the chosen message's attachments or images into the prefill. `deferred`
- Forking into an earlier provider segment (sibling (a)). `deferred`
- Stable Codex live user ids. Fixtures show `userMessage.clientId: null`, and
  whether `turn/start` accepts one is unverified. That would retire the ordinal
  path. `deferred`
- Codex `thread/rollback` or `thread/revert` fallbacks. `declined`
- Mobile, the command palette, and shortcuts. `deferred`

## Test plan

**Rust unit tests:**

- `mainframe-chat/src/fork_cut.rs` (`resolve_fork_cut`):
  - the id fast path;
  - the ordinal fallback;
  - count mismatch (unresolved);
  - the first message;
  - queued, pending and failed messages;
  - a non-user id;
  - an unknown id.
- `mainframe-adapter-claude/src/fork_cut.rs`:
  - the prefix ends right before the match;
  - sidechain, meta and tool-result lines with that uuid are skipped;
  - an `attachment` match gives the "joined a turn" refusal;
  - no match, and an empty prefix, give `PointNotFound`;
  - `subagents/` is still copied.
- Existing `fork.rs` tests prove that `cut: None` is unchanged.
- `mainframe-adapter-codex/src/fork_pin.rs` (`turn_before_message`):
  - the previous turn is chosen;
  - the first turn gives `PointNotFound`;
  - an id that is absent gives `PointNotFound`;
  - an `inProgress` previous turn gives `PointNotFound`.

**Chat layer** (`chat_manager/tests/fork_from_message.rs`, with the mock adapter
recording its `ForkPinRequest`):

- success carries the parent id and the cut;
- every 400, 404 and 409 row creates no row;
- a turn in flight is allowed for `BeforeMessage` and refused for `Current`;
- after a simulated restart, the pending fork still resumes the pinned point.

**Server:** route tests in `routes/chat_fork.rs`:

- `{}` and no body;
- a null `fromMessageId`;
- an empty id;
- a bad pattern;
- an unknown field.

**Adapters:**

- Claude: `session_tests/spawn.rs` asserts that a from-message fork spawns
  `--resume <prefix path> --fork-session` and never `--resume-session-at`.
- Codex: `tests/fork.rs` checks that the pin sends the earlier turn id, the first
  spawn sends `thread/fork` with it, and the unsent history is truncated there.

**UI** (single-file vitest runs):

- `fork-from-message-availability.test.ts`: each reason, in order.
- `UserMessageActionBar.test.tsx`:
  - enabled;
  - each disabled `Hint`;
  - hidden for queued, temporary and no-project chats;
  - a click calls `useForkChat` with the id and prefill.
- `use-fork-chat.test.tsx`: the body is sent, the draft is seeded before
  `switchToThread`, and a failure shows the toast.
- `draft-stash.test.ts`: a seeded draft is taken once.

**E2E:** `tests-tauri/fork-from-message.spec.ts`.

- With `E2E_MOCK_FORK=1`, the daemon registers `MockCliAdapter::with_fork_capable(true)`.
- `chat-user-message-fork` is disabled on the first message with its hint.
- Clicking it on the second message opens a fork with `chat-header-parent-link`,
  and `chat-composer-input` holds that message's text.
- Without the flag, it is disabled with the adapter hint.

## Implementation tasks

0. Run Gate 0, update both CONSUMED-SURFACE files (Claude: a row for the prefix
   snapshot, and `--resume-session-at` in "never passes"; Codex: CODEX-RPC-07 for
   earlier turns), and apply any contingency.
1. Make the adapter API changes: `ForkCut`, `ForkPinRequest.cut` and
   `ForkPinError::PointNotFound` in `mainframe-adapter-api/src/adapter.rs`. Thread
   the field through `mainframe-chat/src/chat_manager/deps.rs` and
   `mainframe-server/src/chat_deps.rs`.
2. Claude: create `mainframe-adapter-claude/src/fork_cut.rs` (prefix copy) and
   branch to it from `fork.rs::pin_fork_point`. First move `fork.rs`'s tests to
   `fork_tests.rs`, because the file is already 361 lines.
3. Codex: add `turn_before_message` in `fork_pin.rs` and use it when `cut` is set.
4. Mock: honor `cut`, record the last pin request, and add the `E2E_MOCK_FORK` toggle
   in `mainframe-daemon/src/main.rs`.
5. Chat layer:
   - add `ForkPoint` and the errors in `fork.rs`;
   - add `resolve_fork_cut` in a new `fork_cut.rs`;
   - change the `fork_chat` signature.
   Split `fork_chat` (now about 120 lines) into eligibility, cut and pin, and insert
   helpers of 50 lines or fewer. Move the snapshot sweep to `chat_manager/fork_sweep.rs`
   so that `fork_api.rs` stays under 300 lines.
6. Server: move the fork handler to `routes/chat_fork.rs`, add the body field and
   validation, and map the new statuses. `chat_commands.rs` is already 370 lines.
7. Types: add `ForkChatRequest` in `packages/types/src/chat.ts` and rebuild types.
8. UI plumbing:
   - `lib/api/chats.ts::forkChat` takes the body;
   - `draft-stash.ts::seedDraft`;
   - `use-fork-chat.ts` takes `{ fromMessageId, prefill }`.
9. UI surface (follow the mainframe-design-system skill):
   - extract `ActionIconButton` from `MessageActionBar.tsx` into
     `messages/action-icon-button.tsx`;
   - add `messages/UserMessageActionBar.tsx` (`ActionBarPrimitive.Root
     autohide="always"`; chat state from `activeSessionCustom`, as in
     `use-chat-header-parent-link.ts`);
   - split `forkAvailability`'s checks 1–6 into a shared base used by the new
     `fork-from-message-availability.ts`;
   - render the bar in `UserMessage.tsx` (260 lines; it must stay under 300).
10. Write the tests above, add an e2e spec, add a changeset (`mainframe-types` minor,
    `mainframe-ui` minor), and run `cargo check`, the UI typecheck and
    `tsc --noEmit` for types.
