# Todo #408 implementation plan

Approved behavior: `docs/specs/2026-11-10-todo-408-idle-chat-compaction.md`
at `36f094dba91870808c360e9a850ffe0630fbb8cd`. The spec controls all behavior
and exact UI copy. This plan changes no production application or configuration.

## Established facts

Paths below are relative to the repository; Rust crate paths share the prefix
`packages/core-rs/crates/`, abbreviated `R/` in this document.

- `R/mainframe-chat/src/idle_scanner.rs`, `IdleSessionScanner`,
  `select_idle_candidates`, and `idle_since` implement five-minute offload scans
  and the two-hour deadline, using the spawned adapter's activity clock.
- `R/mainframe-chat/src/lifecycle_manager/flight_claims.rs`, `begin_send`,
  `end_send`, and `try_claim_offload` serialize sends/offload. Both ends of a send
  touch activity. Maintenance must get a separate claim under the same guards.
- `R/mainframe-chat/src/chat_manager/send_entry.rs`, `send_message`, calls
  `mark_turn_accepted` before delivery. `send_queue.rs`, `queued_message_metadata`,
  infers a queue from Working and replay acknowledgement. Its existing queue is
  CLI-owned; merely waiting in `begin_send` does not persist a user message.
- `R/mainframe-chat/src/event_handler/sink_result.rs`, `handle_result`, persists
  run totals, changes process/turn state, drains queue bookkeeping, emits timing,
  and sends notifications. Maintenance completion must branch before these.
- `R/mainframe-chat/src/event_handler/sink_metadata.rs`, `handle_compact`, creates
  a transient Compaction node and emits a Done surface event; `handle_compact_start`
  emits Started. `handle_context_usage` retains explicit provider context totals.
- `R/mainframe-adapter-api/src/adapter/adapter_session.rs`, `AdapterSession`, has
  default capability methods but no native compaction trigger. Add defaults so
  ACP, mock, and other implementations remain unsupported unless opted in.
- `R/mainframe-adapter-claude/src/session_prompt.rs` and `session_process.rs`
  bump activity; `events.rs` also calls `bump_last_activity`. `event_system.rs`
  maps `compact_boundary` and compacting status to existing sink callbacks.
- `R/mainframe-adapter-claude/src/event_result.rs`, `result_usage`, distinguishes
  context from billing usage; `history_converters.rs`, `compaction_message`,
  reconstructs provider compaction rows. Native transcript reconstruction alone
  does not supply daemon idle origin or internal-command provenance.
- `R/mainframe-adapter-codex/src/compaction.rs`,
  `handle_compaction_completed`, deduplicates via `compaction_emitted`;
  `turn_lifecycle.rs` resets it on turn start. Explicit maintenance cannot depend
  on a turn start. `jsonrpc.rs`, `JsonRpcClient::request`, correlates RPC replies
  with a default 30-second timeout; a reply is separate from a notification.
- Claude `session_control.rs`, `ControlRequestChannel::send_awaiting`, defaults its request wait
  to five seconds. Neither this nor Codex RPC acknowledgement proves compaction
  finished. Completion needs a separately bounded wait using these policy values.
- `R/mainframe-server/src/routes/settings.rs`, `GeneralPatch`, `general_body`,
  `put_general`, and `write_general` own the typed GET and pre-write validation.
  Current arbitrary stored keys otherwise pass through as strings.
- `packages/types/src/settings.ts`, `GeneralConfig` and `GENERAL_DEFAULTS`, own
  the TS contract. `packages/ui/src/lib/api/settings.ts`, `getGeneralSettings`,
  currently uses manual response checks; the new Zod schema must actually run
  here and at the outgoing patch boundary.
- `R/mainframe-types/src/chat.rs`, `MessageContentNode::Compaction`, feeds
  `mainframe-acp/src/encoder/content.rs` and `encoder/accum.rs`. The encoder
  currently turns compaction into `isCompacted` metadata on its open segment.
  Idle rows require their own stable message target to avoid attaching the idle
  marker or its action exclusion to a preceding assistant message.
- `packages/ui/src/features/chat/messages/SystemMessage.tsx`, `CompactionPill`,
  uses Marker separator, Layers icon and muted default styling.
  `ProviderSwitchMarker.tsx`, `ProviderSwitchMarker`, supplies the Hint pattern.
  `features/settings/panes/general/GeneralPane.tsx`, `GeneralPane`, has Worktree
  directory immediately before Updates; its `saveError` is the error pattern.

These are source observations. Provider TTLs, exact native RPC method and cache
classification rules come from the approved spec, not a newly verified provider
promise. No live provider experiment is needed to author this plan.

## Design and implementation decisions

Use three substantive ownership groups. Tests stay with their implementation.
G2 owns runtime integration and persistence; G3 consumes G1's metadata contract
and therefore can proceed alongside G2 without editing its Rust files.
Each implementer preserves others' edits and splits helpers rather than exceeding
300 lines per file or 50 per function. Existing oversized touched files must be
split as needed without expanding their ratchet allowance.

Represent a real run with a persisted unique generation, completion outcome,
and normal completion timestamp. Existing records without proven completion
stay ineligible. Allocate generation at real-turn acceptance, record completion
only on normal result, and retain interrupted/error outcome as disqualifying.
A successful real run rearms using its new generation. Maintenance is never a run.

Persist a conditional claim for that generation on the chat before provider I/O.
Use `idle-compact:<chatId>:<realRunId>` and keep it through every outcome, including
crash before send. Session generation and request identity scope live origin;
correlated completion data must survive reload via daemon-owned provenance.
Do not infer origin from `/compact` text or timestamps.

## G1: Adapter, timing and public contracts

- kind: core
- parallel_safe: true
- depends_on: []
- Ownership: `R/mainframe-adapter-api/`, `R/mainframe-adapter-claude/`,
  `R/mainframe-adapter-codex/`, `R/mainframe-types/src/`,
  `R/mainframe-acp/src/encoder/` and its encoder tests,
  `packages/types/src/`, `R/mainframe-server/src/routes/settings.rs`,
  settings route tests, new settings route helper modules,
  `R/mainframe-db/src/settings*.rs` and new settings transaction helpers/tests.

1. Add default-unsupported native compaction capability/trigger, typed request
   origin/id/session generation, completion metadata with optional provider
   counts, cache classification and provider readiness. Forward added sink
   metadata through wrappers, recording/null sinks and mock compatibility.
2. Implement Claude internal `/compact` through the existing command writer,
   encoding maintenance input as literal slash-command text and preserving
   command UUID provenance. Scope stdin, stdout and event activity
   suppression to that maintenance request. Classify init/account/routing and
   nested usage evidence per spec, retain classification on missing/zero usage,
   prefer decisive usage, and reset on replacement or routing/account change.
3. Implement Codex `thread/compact/start` with current `{ threadId }`, accepting
   empty acknowledgement without fabricating completion. Reset explicit-request
   dedup without `turn/started`; correlate canonical item ids and legacy events.
   Ignore duplicates and quarantine late completions so they cannot label a newer
   manual/automatic compaction. Timeout does not assert provider readiness.
4. Export named Claude 60-minute and Codex 30-minute policy constants and pure
   captured-clock window calculations. Validate the positive integral daemon
   override with checked arithmetic; derive TTL D/0.9 and ceil/min sweep cadence.
   Keep all eligibility rules and offload timing independent of the override.
5. Add nested default-false settings types and Zod response/patch schemas.
   Rust GET decodes `idleCompaction.enabled` as a boolean, with missing=false.
   Validate complete patch before any writes; preserve omitted and unrelated
   keys and add transactional settings storage for atomic failure if existing
   write primitives cannot provide it. Keep status/error envelope.
6. Carry optional idle origin/counts through Compaction/display/shared TS/ACP
   metadata. Encode idle compaction as a separate message with a stable id and
   non-actionable metadata; preserve ordinary compaction encoding.
7. Add adapter fixtures/tests for cache evidence precedence, mixed and zero
   usage, proxy routing/reset, exact command/RPC shape, empty response, start-less
   completion, dedup, late events, timeout/readiness and unchanged normal paths.
   Add Rust/TS settings default and invalid-input tests, plus encoder metadata
   and message-boundary tests. Cover pure time boundaries and override validation.

## G2: Durable lifecycle, scheduling and side effects

- kind: core
- parallel_safe: true
- depends_on: [G1]
- Ownership: `R/mainframe-chat/`, `R/mainframe-db/` except G1 settings files,
  `R/mainframe-server/src/chat_deps*`, `R/mainframe-server/src/wiring/`,
  daemon configuration/startup owners outside G1, their tests, `.changeset/`.

1. Add migration and chat repository conditional-claim operation, completed-real-
   run state and command/completion provenance. Wire through chat dependency
   ports and server DB actor. Claim compares the current generation and absent
   claim atomically. Persistence errors prevent I/O; no best-effort fallback.
   Keep settings storage outside this ownership group.
2. Add maintenance exclusion to lifecycle guards, offload checks and session
   replacement/interrupt/exit cleanup. Select only registry sessions, never call
   start/resume/history-load to make a candidate. Under the send guard's shared
   critical section re-read config, run/session identity and every eligibility
   condition immediately before claiming and sending, including inclusive expiry.
3. Add separate one-minute scanner with controlled clock, skip missed ticks and
   override cadence; own its start/stop alongside offload wiring. Re-evaluate on
   normal real-run completion. Unknown state fails closed. Use explicit latest
   context size, never aggregate consumption. Check archive, delegation/parent,
   permission, queue, tools, background tasks, subagents and transcript tail.
4. Extend existing delivery queue bookkeeping with a daemon-held maintenance
   branch. Persist accepted user messages and UUIDs once, preserve attachments,
   command metadata and edit/cancel/error behavior. Queue without Working or
   steer/interrupt calls attributable to maintenance. Clear origin before FIFO
   drain; send readiness gates input if timeout left the provider busy. Preserve
   normal activity and status effects of actual user sends.
5. Track request-scoped terminal lifecycle via existing compaction signals.
   Resolve successful marker once, persist origin/counts/provenance, and merge
   with native history using stable provider ids. Hide only matched internal
   Claude command and echo live/reload. Handle failure, interruption, timeout,
   exit and replacement without fake success or retry; retain durable claim.
6. Route maintenance result/progress before normal sink result/notification
   machinery. Suppress unread, turn/running/parent status, notifications/push,
   sound, titles, transient compacting indicator, and clock touches at source.
   Preserve newer real activity; never restore timestamp snapshots. Keep offload
   deadline unchanged and block only while maintenance is reserved. Exclude idle
   rows/hidden commands from fork and rewind validation on the server as well.
7. Add focused lifecycle/DB/history tests with fake sessions and barriers covering
   every spec acceptance rejection separately. Cover selection/send races, two
   simultaneous sweeps plus completion hook, disable before dispatch, persistence
   failure, crash/restart claim survival with recreated live session, ambiguous
   send error, new run rearm, FIFO success/failure drain, timeout busy provider,
   duplicate/late events, reload parity and normal compaction regression.
8. Assert every prohibited event/clock change through recording dependencies and
   sink observers, including both adapter clocks and lifecycle touch points,
   offload deadline, and real user activity retained during maintenance. Add
   settings restart/atomic-storage checks and a feature changeset.

## G3: Settings and transcript UI

- kind: ui
- parallel_safe: true
- depends_on: [G1]
- Ownership: `packages/ui/src/lib/api/settings.ts` and API tests,
  `packages/ui/src/store/settings.ts` and store tests,
  `packages/ui/src/features/settings/panes/general/` and relevant shared tests,
  `packages/ui/src/features/chat/messages/`, `features/chat/view-model/`,
  `features/chat/controller/` normalization/action tests and helpers.

1. Parse general responses and validate outgoing patches with G1 Zod schemas.
   Merge nested store defaults for existing installs. Save toggle against latest
   acknowledged state, disable pending writes, roll back failed saves and use
   existing error presentation without replacing unrelated concurrent settings.
2. Insert Chats between Worktree directory and Updates. Use ToggleRow/Switch,
   exact approved label/helper and `idle-compaction-enabled`; preserve keyboard,
   focus, disabled and screen-reader behavior. No Appearance/mobile control.
3. Normalize origin/counts and stable message id for live and reloaded metadata.
   Extend separator marker with `Compacted while idle`, optional quieter counts
   only when both are present, exact tooltip via Hint, and
   `idle-compaction-<messageId>`. Reuse icon/hairlines/light/dark tokens.
   Exclude marker/hidden command from fork/rewind actions. Ordinary markers stay
   unchanged; no maintenance progress indicator is introduced.
4. Add component/API/store/controller tests for defaults, Zod rejects, successful
   and failed saves, unrelated-setting preservation, section order/accessibility,
   marker label/counts/tooltip/id, live/reload metadata parity, action exclusion,
   absent transient status and normal marker regression.

## Acceptance coverage and verification intent

Spec acceptance 1 maps to G1 settings/type tests, G2 repository/restart tests,
and G3 API/store/toggle tests. Acceptance 2 maps to G1 pure clock tests at Claude
53/54/60/61 and Codex 26/27/30/31 minutes, exact expiry plus 1 ms, rollback,
and G2 disabled/final-recheck tests. Acceptance 3 maps to G2 eligibility cases
including exactly 20k/below/unknown and error/interrupted runs. Acceptance 4 maps
to G1 classification/override tests and G2 controlled-clock scanner tests.
Acceptance 5 maps to G2 contention, persistence, restart and failure tests.
Acceptance 6 maps to G1 Codex recorded RPC/event tests. Acceptance 7 maps to G1
Claude fixtures and G2 native-history/provenance tests. Acceptance 8 maps to G1
adapter activity tests, G2 lifecycle/event/queue/action tests and G3 action tests.
Acceptance 9 maps to G3 component tests, including light/dark marker states.

Run focused tests while implementing each group, then affected Rust checks,
TS typechecks, lint and the repository daemon gate before implementation commits.
Read current package scripts/build constraints to choose checks; no predicted
command output is evidence. Keep hooks enabled and scan staged files for secrets.
No tests or builds are required for this plan-only commit.

After G2/G3 integration, lane QA uses one isolated daemon/data directory/free
port, delay about 60,000 ms and controlled throwaway sessions just past 20k.
At most one paid Claude and one paid Codex compaction, recording missing login
as BLOCKED. Verify marker, all absent side effects, FIFO delivery and next-turn
context versus matched baseline when usage permits. Capture toggle on/off and
idle marker light/dark in 2–3 captures, check narrow/compact layout, record tested
SHA and PASS/FAIL/BLOCKED per scenario. Do not run Playwright/Tauri e2e suites.
Never touch production app, 31415 or `~/.mainframe`; stop only owned processes.
Stop below 15 GB free disk or critical memory pressure; at most one owned Cargo
build. QA belongs to the lane after implementation, not this authoring task.

## QA correction, 2026-11-10

The one permitted Claude attempt submitted XML command markup as user text.
The native transcript recorded an ordinary assistant turn without a compact
boundary, and the daemon rejected completion before the five-second timeout.
Idle maintenance now sends literal `/compact` text with the same command UUID.
The existing boundary-plus-successful-result gate and timeout remain unchanged.
This corrects command encoding without changing the approved completion policy.

The `qa408-non-compaction.jsonl` adapter fixture preserves the observed event
kinds and command text with identifiers and assistant content replaced. Its
terminal success result is synthetic: native history does not persist stream
results. It tests that an ordinary successful turn cannot fabricate compaction.
The command-dispatch regression separately requires literal `/compact` and tests
boundary-plus-result completion. It failed on the original XML encoding.

Original live S3 remains FAIL. Regression coverage passes after the fix, but fresh
live Claude success coverage is BLOCKED because the one-attempt limit is spent.
No paid provider may be invoked for rechecking this correction. Q2 overlapping
queue-drain polling remains separate.
