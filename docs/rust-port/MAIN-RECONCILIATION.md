# MAIN-RECONCILIATION — Node daemon → Rust port

Reconciliation of every `packages/core/src` (Node daemon) and `packages/types/src`
(wire types) change merged into `origin/main` after the Rust port branched, mapped
to what must change in `packages/core-rs`.

- **Range:** `BASE = 704799b9` … `origin/main = aa2dce69` (merge tip on branch
  `feat/daemon-rust-port` is `efcfae62`).
- **Diff commands:** `git diff BASE origin/main -- packages/core/src packages/types/src`,
  `git log BASE..origin/main -- packages/core packages/types`.
- Scope: 53 core production files + 5 types production files changed, plus ~40 test
  files. 16 brand-new production modules (all confirmed **absent** in `core-rs` today).

## Legend

- **WIRE** — changes a `DaemonEvent`/HTTP route/response shape or a `packages/types`
  type the UI consumes. MUST port to keep the Rust daemon wire-compatible.
- **DAEMON-INTERNAL** — server-side logic/behavior, no wire-shape change, but affects
  correctness/parity. Port for fidelity.
- **NON-DAEMON** — lives in ui/app-electron/app-tauri, or is a pure test/comment/
  release chore. SKIP for the Rust port (reason given).

## Summary

- **Clusters:** 12 (A wire-types, B process-sweep/child-reaping, C cors/startup,
  D context-meter, E degraded-recovery/transcript, F background-activity/kind,
  G subagent-Task-grouping, H adapter-catalog-alignment, I codex-external-sessions/titles,
  J session-context-dedup, K file-watch-rearm, L read-only-external-files).
- **Production-file classification tally (58 files):**
  - **WIRE ≈ 10** — types: `adapter.ts`, `background-task.ts`, `chat.ts`, `display.ts`;
    core: `chat/chat-manager.ts`, `server/cors-origin.ts`, `server/http.ts`,
    `server/routes/chat-recovery.ts`, `server/routes/chats.ts`, `server/routes/files.ts`.
  - **DAEMON-INTERNAL ≈ 47** — everything else (all adapter/chat/db/process/tunnel/launch logic).
  - **NON-DAEMON ≈ 1 production** — `types/host/host-bridge.ts` (`reanchor?`, desktop-shell
    bridge, low-priority). Plus test-only/chore commits: `48218b7e` provider logos (only a
    core **test** changed — the feature is UI), and all `chore: version/prepare release` commits.
- **16 NEW modules needing new Rust files** (none exist in `core-rs`): `chat/degraded-recovery.ts`,
  `chat/transcript-presence.ts`, `claude/context-files.ts`, `claude/title-generator.ts`,
  `claude/transcript.ts`, `codex/external-session-parse.ts`, `codex/external-sessions.ts`,
  `codex/transcript.ts`, `process/child-registry.ts`, `process/sweep.ts`, `process/index.ts`,
  `server/cors-origin.ts`, `server/routes/chat-recovery.ts`, `settings/model-default.ts`,
  `tunnel/resolve-cloudflared.ts` (+ `chat-recovery` route mount).
- **Already handled in core-rs:** DB **migration 25** (`last_context_total_tokens`,
  `last_context_max_tokens`, `transcript_missing` on `chats`) is ported in
  `mainframe-db::migrations` (version 25, lines ~409–427). NOTHING else is ported yet —
  the `mainframe-types` structs and the `mainframe-db::chats` repository (SELECT list,
  row mapping, update field-map, `clearSession`/`clearWorktree`) still need the matching
  fields, and every new module above is missing.

## Recommended porting order (parallelizable execution plan)

**Wave 0 — serial gate.** Cluster **A (wire types)** first: the serde structs and the two
new `Adapter` trait methods (`generateTitle`, `isTranscriptPresent`) plus the new fields are
depended on by D/E/F/H/I. Immediately after, add the `mainframe-db::chats` column plumbing
(SELECT + row map + update field-map + `clear_session`/`clear_worktree`) — the migration is
already present; only the repository read/write path is missing. This unblocks D/E/F.

**Wave 1 — fully independent, run in parallel (no shared files):**
- **B** process-sweep + tunnel/launch reaping → `mainframe-launch` (+ `mainframe-daemon`, `mainframe-server`).
- **C** cors/startup → `mainframe-server`.
- **G** subagent Task grouping → `mainframe-display` + `mainframe-adapter-claude`.
- **K** file-watch rearm → `mainframe-services`.
- **L** read-only external files → `mainframe-server::routes::files`.
- **J** session-context dedup + context-files → `mainframe-chat` + `mainframe-adapter-claude`.

**Wave 2 — two coordinated streams (parallel with each other, after Wave 0):**
- **Adapters/catalog stream = H + I** — they share `claude/adapter.ts` and `codex/adapter.ts`,
  so port those two files once, covering catalog alignment (H) and codex disk-import/titles (I).
- **Chat-core stream = D + E + F** — they share `chat/chat-manager.ts`, `chat/event-handler.ts`,
  and `db/chats.ts`, so these files are single port units covering context-meter (D),
  degraded-recovery/transcript (E), and background-activity (F) together.

Ordering deps: A → (db-chats plumbing) → D/E/F; A → H/I; E's `transcript-presence` needs the
adapter `transcript` modules (claude+codex) which live in the adapter crates and can be ported
in parallel then merged. Wave-1 clusters have no dependency on Wave-2 and can start as soon as A lands.

---

## Cluster A — Wire types (`mainframe-types`)  ·  PORT FIRST

Commits: `0e747c29`(#425), `280edfca`(#424), `9c724e6d`/`b717a3fe`(#423/#441),
`a5afda52`(#436). Every added field is the frozen wire contract — check each against
`mainframe-types` serde structs. All camelCase; optionals → `Option<T>` with
`skip_serializing_if = "Option::is_none"` unless a fixture shows explicit `null`.

| File | Feature | What changed | Class | Rust target | Tests | Already handled |
|---|---|---|---|---|---|---|
| `types/adapter.ts` (+31) | #424/#425/#441 | `SessionResult.contextTokens?: number \| null`; `AdapterModel.resolvedModel?: string`; new `Adapter` methods `generateTitle?(content,binary)`, `isTranscriptPresent?(sessionId,projectPath,sessionFilePath?)` | WIRE | `mainframe-types::adapter` (structs) + `mainframe-adapter-api::lib` (trait methods) | — | absent |
| `types/background-task.ts` (+56) | #425 | `BackgroundWorkKind` enum + zod; `BackgroundTask.kind`; `BackgroundActivityTask`, `BackgroundActivity` + zod schemas; helpers `toActivityTask`, `deriveBackgroundActivity` | WIRE | `mainframe-types::background_task` | `types/__tests__/background-activity.test.ts` | absent |
| `types/chat.ts` (+13) | #423/#424/#425 | `Chat.lastContextTotalTokens?`, `lastContextMaxTokens?`, `backgroundActivity?: BackgroundActivity`, `transcriptMissing?: boolean` | WIRE | `mainframe-types::chat` | (covered by chat-manager/db tests) | migration cols ported; struct fields absent |
| `types/display.ts` (+9) | #424 | new `ChatHistoryPayload { messages: DisplayMessage[]; transcriptMissing: boolean }` (GET /messages body) | WIRE | `mainframe-types::display` | — | absent |
| `types/host/host-bridge.ts` (+8) | #436 | `PreviewHandle.reanchor?(el)` — Tauri child-webview re-anchor | NON-DAEMON | `mainframe-types::host::host_bridge` (low-pri; daemon does not consume) | — | absent |

### A — field-by-field wire checklist (verify each against `mainframe-types` + fixtures)

- **`adapter.ts` → `SessionResult`**: add `context_tokens: Option<Option<i64>>`? No — it is
  `number | null` **and** optional. Model as `Option<Option<i64>>` is wrong for serde;
  use `#[serde(default, skip_serializing_if="Option::is_none")] context_tokens: Option<i64>`
  where absent (legacy) and `null` (unknown-this-turn) BOTH deserialize to `None`, but the
  daemon MUST distinguish them on the **producing** side (see D). The event-handler logic:
  `undefined → fall back to usage`; `null → keep stored`; number>0 → update. Preserve the
  three-way branch even though the JSON collapses absent/null.
- **`adapter.ts` → `AdapterModel`**: add `resolved_model: Option<String>` (`resolvedModel`).
- **`adapter.ts` → `Adapter` trait**: add optional methods `generate_title(content,binary)
  -> Option<String>` and `is_transcript_present(session_id, project_path, session_file_path:
  Option<&str>) -> Option<bool>` (`null` = "cannot determine — don't flag").
- **`background-task.ts`**: `BackgroundWorkKind` = enum `{bash,agent,workflow,other}`
  (`rename_all="lowercase"`); `BackgroundTask.kind` (required); `BackgroundActivityTask
  {id,kind,description,startedAt}`; `BackgroundActivity {total,byKind: Partial<Record<kind,
  number>>, tasks[]}` — `byKind` → `HashMap<BackgroundWorkKind,u32>` skipping zero/absent
  kinds (only positive counts). Port `to_activity_task` (desc falls back to `command`) and
  `derive_background_activity` (returns `None` on empty list).
- **`chat.ts`**: `last_context_total_tokens: Option<u64>`, `last_context_max_tokens:
  Option<u64>`, `background_activity: Option<BackgroundActivity>` (never persisted — derived
  per response), `transcript_missing: Option<bool>` (persisted).
- **`display.ts`**: `ChatHistoryPayload { messages: Vec<DisplayMessage>, transcript_missing:
  bool }` — the GET `/api/chats/:id/messages` `data` envelope changes from a bare array to
  this object (breaking response-shape change — see Cluster E `routes/chats.ts`).

---

## Cluster B — process-sweep subsystem + tunnel/launch child reaping

Commits: `a38f85fd`(#431), `4eab7ed0`(#442). A shared pidfile registry lets a startup
sweep reap tunnel + launch children a crashed daemon leaked. **`process/` is NOT in the
PORTING crate map** — recommend a new module under `mainframe-launch` (shared by tunnel +
launch, both already there): `mainframe-launch::process::{child_registry,sweep}` (or a small
`mainframe-process` crate if a reviewer prefers). Boot wiring lands in `mainframe-daemon`.

| File | Feature | What changed | Class | Rust target | Tests | Already handled |
|---|---|---|---|---|---|---|
| `process/child-registry.ts` NEW (147) | #431 | `ManagedChildEntry` (pid,kind,command,args,cwd,group,label,spawnedAt); `ChildRegistryPort`; `NoopChildRegistry`; `FileChildRegistry` — serialized (tail-promise) + atomic (tmp+rename) pidfile, validated-on-read | DAEMON-INTERNAL | `mainframe-launch::process::child_registry` (NEW) | `process/child-registry.test.ts` (142) | absent |
| `process/sweep.ts` NEW (220) | #431/#442 | `sweepStrayChildren` (TERM→grace→KILL, prune record on gone/reused/reaped); `processMatchesBinary` (exact abs path); `processMatchesLaunch` (full argv + cwd guard); `defaultProcessCommand` (`ps -o command=`), `defaultProcessCwd` (`lsof -d cwd -Fn`), `defaultKill`; win32 = skip, keep registry | DAEMON-INTERNAL | `mainframe-launch::process::sweep` (NEW) | `process/sweep.test.ts` (325) | absent |
| `process/index.ts` NEW | #431 | re-exports | DAEMON-INTERNAL | module `pub use` | — | absent |
| `tunnel/tunnel-manager.ts` (+64) | #431/#442 | ctor takes `TunnelManagerOptions {registry, cloudflaredPath}`; `recordSpawn`/`forgetSpawn` (abs-path only); `pending` Set reaps mid-start children in `stopAll`; spawn `cloudflaredPath` not bare `cloudflared` | DAEMON-INTERNAL | `mainframe-launch::tunnel_manager` | `tunnel/tunnel-manager.test.ts` (+175) | absent |
| `tunnel/resolve-cloudflared.ts` NEW (40) | #431 | `resolveCloudflaredPath` — scan PATH for abs `cloudflared[.exe]`, X_OK check | DAEMON-INTERNAL | `mainframe-launch::resolve_cloudflared` (NEW) | `tunnel/resolve-cloudflared.test.ts` (53) | absent |
| `tunnel/index.ts` (+2) | #431 | export `resolveCloudflaredPath`, options types | DAEMON-INTERNAL | `mainframe-launch::tunnel` (re-export) | — | absent |
| `launch/launch-manager.ts` (+51) | #431 | ctor `childRegistry?`, injectable `readProcessCommand` (`ps`); `recordSpawn` records LIVE command line (post-`#!` argv) + realpath cwd, records after spawn-confirm before port-wait; `forgetSpawn` on exit/error/stop | DAEMON-INTERNAL | `mainframe-launch::launch_manager` | `launch/launch-manager-tracking.test.ts` (183), `launch/launch-reap-integration.test.ts` (70) | absent |
| `launch/launch-registry.ts` (+4) | #431 | pass `childRegistry` down to each `LaunchManager` | DAEMON-INTERNAL | `mainframe-launch::launch_registry` | — | absent |
| `index.ts` (daemon, +34) | #431/#442 | boot: one `FileChildRegistry(managed-children.json)` shared by tunnel+launch; resolve cloudflared path; `sweepStrayChildren` AFTER port bind (bind is single-instance guard); broadcast `background_task.updated`; `tunnelManager.stopAll()` on uncaughtException; 200ms flush before fatal `exit(1)` | DAEMON-INTERNAL | `mainframe-daemon::main` (boot + shutdown) | — | absent |
| `server/index.ts` (+8) | #442 | `listen` rejects on bind `error` (EADDRINUSE) instead of unhandled → silent death; late error handler after listen | DAEMON-INTERNAL | `mainframe-server::lib` (server start) | `server/server-start-error.test.ts` (45) | absent |

Independent of every other cluster (only depends on `DaemonEvent`). Fully parallelizable.

---

## Cluster C — CORS allowlist + packaged startup + health pid

Commits: `f3754e69`(#411, packaged desktop startup), `4eab7ed0`(#442, health pid).

| File | Feature | What changed | Class | Rust target | Tests | Already handled |
|---|---|---|---|---|---|---|
| `server/cors-origin.ts` NEW (19) | #411 | `isAllowedOrigin` — regex now allows `tauri://localhost` + `http(s)://tauri.localhost` in addition to localhost/127.0.0.1; too-narrow list made packaged Tauri hang | WIRE (ACAO response header) | `mainframe-server::cors_origin` (NEW) | `server/cors-origin.test.ts` (68) | absent |
| `server/http.ts` (+10) | #411/#442/#424 | use `isAllowedOrigin`; `/health` response gains `pid: process.pid`; mount `chatRecoveryRoutes` | WIRE (health body + CORS) | `mainframe-server::http` | (cors-origin.test.ts) | absent |

Independent; parallelizable. Note the health `pid` field is a wire addition.

---

## Cluster D — context-meter over-reporting (context-tracker/meter)

Commits: `9c724e6d`(#423), `280edfca`/`0e747c29` share `event-handler.ts`. Fixes the meter
double-counting multi-call turn usage; persists the CLI's own `get_context_usage` totals.

| File | Feature | What changed | Class | Rust target | Tests | Already handled |
|---|---|---|---|---|---|---|
| `claude/events.ts` (+18) | #423/#425 | result: `contextTokens` = last **parent** assistant usage (input+cache), else `null` (never the QueryEngine turn total); ALSO `task_updated` subtype + `task_type` passthrough (Cluster F) | DAEMON-INTERNAL | `mainframe-adapter-claude::events` | `claude-events.test.ts` (70) | absent |
| `claude/assistant-event.ts` (+27) | #423 | `hasNonZeroUsage` gate — synthetic/error all-zero usage no longer clobbers stored size; subagent (`parent_tool_use_id`) usage never captured as `lastAssistantUsage` | DAEMON-INTERNAL | `mainframe-adapter-claude::assistant_event` | (claude-events / task-events tests) | absent |
| `chat/event-handler.ts` (+54) | #423/#424/#425 | `onResult`: three-way `contextTokens` branch (undefined→usage, null→keep, >0→update) never zero-clobbers `lastContextTokensInput`; `onContextUsage`: persist `lastContextTotalTokens`/`MaxTokens` + broadcast `chat.updated` (ungated). ALSO (F) drain-turn re-entry flips `processState` back to working; `tracker.endAllRunning` on session end | DAEMON-INTERNAL | `mainframe-chat::event_handler` (shared w/ F) | `event-handler.test.ts` (94), `event-handler-background-activity.test.ts` (113) | absent |
| `db/chats.ts` (+32) | #423/#424 | SELECT adds `last_context_total_tokens`, `last_context_max_tokens`, `transcript_missing`; row map + `updateFieldMap` entries; `mapRow` null→undefined for the two token cols, `Boolean()` for transcriptMissing; ALSO (E) `clearSession`, `clearWorktree` | DAEMON-INTERNAL | `mainframe-db::chats` (shared w/ E) | `db/transcript-missing.test.ts` (83) | migration ported; repo plumbing absent |
| `db/schema.ts` (+12) | #423/#424 | ADD COLUMN `last_context_total_tokens`, `last_context_max_tokens` (INTEGER), `transcript_missing` (INTEGER DEFAULT 0) | DAEMON-INTERNAL | `mainframe-db::migrations` v25 | (migrations test) | **ALREADY PORTED (migration 25)** |

Depends on A (`contextTokens`, chat context fields) + db plumbing. Shares `event-handler.ts`/
`db/chats.ts` with E and F → port those files once (chat-core stream).

---

## Cluster E — degraded-recovery + transcript presence

Commit: `280edfca`(#424). Detects deleted CLI transcripts (`transcript_missing` flag) and
adds the three recovery actions behind the degraded-chat card.

| File | Feature | What changed | Class | Rust target | Tests | Already handled |
|---|---|---|---|---|---|---|
| `chat/transcript-presence.ts` NEW (77) | #424 | `reconcileTranscriptPresence(deps,chat)` — stat via adapter `isTranscriptPresent`; skip when working / no sessionId (clears stale flag) / adapter lacks predicate / `null`; persist flip + mirror + `chat.updated` | DAEMON-INTERNAL | `mainframe-chat::transcript_presence` (NEW) | `chat/transcript-presence.test.ts` (117) | absent |
| `chat/degraded-recovery.ts` NEW (85) | #424 | `continueHere` (clearSession + drop caches), `continueInProjectRoot` (clearWorktree), `recreateChatWorktree` (branchExists → addWorktree, 409 when branch gone); kills spawned session first | DAEMON-INTERNAL | `mainframe-chat::degraded_recovery` (NEW) | `chat/degraded-recovery.test.ts` (139) | absent |
| `chat/chat-manager.ts` (+84) | #424/#425 | `getDisplayMessages` → returns `ChatHistoryPayload` + reconciles transcript; `reconcileTranscript`, `continueHere`/`continueInProjectRoot`/`recreateWorktree`; auto-`continueHere` on send when `transcriptMissing` && not spawned; passes `tracker` to EventHandler; `enrichChat` sets `backgroundActivity` + widens `displayStatus` working via live tasks (Cluster F) | WIRE (ChatHistoryPayload + Chat fields) | `mainframe-chat::chat_manager` (shared w/ F) | `chat/chat-manager-degraded.test.ts` (103), `chat-manager-background-activity.test.ts` (121) | absent |
| `chat/external-session-service.ts` (+28) | #424/#430 | `sweepTranscriptPresence(projectId)` on auto-scan cadence; title gen now adapter-aware (`adapter.generateTitle`, else keep deterministic) — Cluster I | DAEMON-INTERNAL | `mainframe-chat::external_session_service` | `chat/external-session-sweep.test.ts` (47) | absent |
| `claude/transcript.ts` NEW (34) | #424 | `getSessionJsonlPath` (moved from history.ts); `isClaudeTranscriptPresent` (checks sessionFilePath then derived path, `access(R_OK)`) | DAEMON-INTERNAL | `mainframe-adapter-claude::transcript` (NEW) | `claude/transcript.test.ts` (34) | absent |
| `codex/transcript.ts` NEW (41) | #424 | `isCodexTranscriptPresent` — thread-registry lookup → rolloutPath, `realpath`, containment under `~/.codex/sessions`; `null` when no row/path/escapes | DAEMON-INTERNAL | `mainframe-adapter-codex::transcript` (NEW) | `codex/transcript.test.ts` (58) | absent |
| `claude/history.ts` (+8) | #424 | `getSessionJsonlPath` now imported from `transcript.ts` (dedup) | DAEMON-INTERNAL | `mainframe-adapter-claude::history` | — | absent |
| `db/chats.ts` | #424 | `clearSession` (NULL claude_session_id/session_file_path, transcript_missing=0), `clearWorktree` (NULL worktree_path/branch_name) — see Cluster D row | DAEMON-INTERNAL | `mainframe-db::chats` | (db/transcript-missing.test.ts) | absent |
| `workspace/worktree.ts` (+26) | #424 | `branchExists` (`rev-parse --verify --quiet refs/heads/…`), `addWorktreeForBranch` (`worktree prune` then `worktree add path branch`, no timeout) | DAEMON-INTERNAL | `mainframe-services::workspace::worktree` | (degraded-recovery.test.ts) | absent |
| `server/routes/chat-recovery.ts` NEW (52) | #424 | POST `/api/chats/:id/{recreate-worktree,continue-here,continue-in-project-root}` → `okEmpty`; 404 unknown chat; honor `err.statusCode` (409) | WIRE (new routes) | `mainframe-server::routes::chat_recovery` (NEW) | `routes/chat-recovery.test.ts` (86) | absent |
| `server/routes/chats.ts` (+4) | #424 | GET `/messages` `data` now the `ChatHistoryPayload` object (was bare array) | WIRE | `mainframe-server::routes::chats` | `routes/chats-messages.test.ts` (28) | absent |
| `server/routes/index.ts` (+1) | #424 | export `chatRecoveryRoutes` | DAEMON-INTERNAL | `mainframe-server::routes` mount table | — | absent |
| `claude/adapter.ts` / `codex/adapter.ts` | #424 | `isTranscriptPresent` delegates to the transcript modules — see H/I rows (shared adapter files) | DAEMON-INTERNAL | adapter crates | — | absent |

Depends on A (transcriptMissing, ChatHistoryPayload, `isTranscriptPresent` trait) + db plumbing.
`chat-manager.ts`/`event-handler.ts`/`db/chats.ts` shared with D & F (chat-core stream).

---

## Cluster F — background-activity / working indicator + `kind` field

Commit: `0e747c29`(#425). Live agents/bash/workflows surface in the sidebar; a new `kind`
tags every task; a duplicate live-start upserts as `updated` not double-counted `started`.

| File | Feature | What changed | Class | Rust target | Tests | Already handled |
|---|---|---|---|---|---|---|
| `background-tasks/tracker.ts` (+40) | #425 | `start` seed gains `kind`; live-dup start → upsert (keep startedAt/lastOutputLine, emit `updated` not `started`); `listLive`; `endAllRunning(chatId)` (stop each, emit ended, return count); `on()` adds `background_task.updated` | DAEMON-INTERNAL | `mainframe-background-tasks::tracker` | `background-tasks/__tests__/tracker.test.ts` (+95) | absent |
| `background-tasks/liveness.ts` (+5) | #425 | lsof-writer liveness now bash-only (`if kind!=='bash' continue`) — agents/workflows have no writer | DAEMON-INTERNAL | `mainframe-background-tasks::liveness` | `background-tasks/__tests__/liveness.test.ts` (+21) | absent |
| `background-tasks/reconcile.ts` (+1) | #425 | recovered snapshot sets `kind:'bash'` (only bash spools to disk) | DAEMON-INTERNAL | `mainframe-background-tasks::reconcile` | — | absent |
| `claude/task-events.ts` (+37) | #425 | `mapTaskKind(taskType,hasBashMetadata)` (prefix-tolerant → agent/bash/workflow/other); seed sets `kind`; `handleTaskUpdated` (terminal status only, tracker dedups) | DAEMON-INTERNAL | `mainframe-adapter-claude::task_events` | `claude/task-events.test.ts` (59), `task-events-integration.test.ts` (35) | absent |
| `claude/events.ts` | #425 | `task_updated` subtype → `handleTaskUpdated`; `task_type` on task_started (see D row) | DAEMON-INTERNAL | `mainframe-adapter-claude::events` | (claude-events.test.ts) | absent |
| `chat/event-handler.ts` | #425 | drain-turn re-entry (assistant after result flips `processState` back to working); `endAllRunning` on session end — see D row | DAEMON-INTERNAL | `mainframe-chat::event_handler` | (event-handler-background-activity.test.ts) | absent |
| `chat/chat-manager.ts` | #425 | `enrichChat` sets `backgroundActivity` from `tracker.listLive`, widens `displayStatus`; passes tracker to EventHandler — see E row | WIRE (Chat.backgroundActivity) | `mainframe-chat::chat_manager` | (chat-manager-background-activity.test.ts) | absent |
| `index.ts` (daemon) | #425 | broadcast `background_task.updated` — see B row | DAEMON-INTERNAL | `mainframe-daemon::main` | — | absent |

Depends on A (`kind`, `BackgroundActivity`) + tracker. Shares chat-manager/event-handler with D/E.

---

## Cluster G — subagent Task grouping (display pipeline)

Commit: `84a37888`(#419). Group subagent messages under their Task card; per-parent progress
buckets; hidden-thinking suppression. Output `DisplayMessage` shape unchanged (which blocks
are emitted changes) → DAEMON-INTERNAL, but exercise the golden display fixtures.

| File | Feature | What changed | Class | Rust target | Tests | Already handled |
|---|---|---|---|---|---|---|
| `messages/tool-grouping.ts` (243) | #419 | `groupToolCallParts`: progress accumulates per `parentToolUseId` (Map of buckets) → one `_task_progress` per parent, spliced ascending w/ offset; `collectExploreRun` ends run on parent mismatch; drop `sharedParentToolUseId`. `groupTaskChildren` rewritten: two-pass partition — index Tasks, nest any part by `parentToolUseId` regardless of position (parallel/interleaved), untagged stay top-level, unknown-parent tags dropped, childless Task falls back to bare call | DAEMON-INTERNAL | `mainframe-display::tool_grouping` | `messages/tool-grouping.test.ts` (+104), `messages/display-pipeline.test.ts` (144) | absent |
| `messages/display-helpers.ts` (+24) | #419 | index in-content `tool_result` blocks so subagent child cards get results (`grouped._toolResults ?? inContentResults`); skip empty-prose `thinking` blocks (hidden-thinking models) | DAEMON-INTERNAL | `mainframe-adapter-claude::messages::display_helpers` | (display-pipeline.test.ts) | ported crate exists; change absent |
| `claude/history-converters.ts` (+4) | #419 | skip signature-only empty `thinking` blocks in history conversion | DAEMON-INTERNAL | `mainframe-adapter-claude::history_converters` | — | ported crate exists; change absent |

Independent (display + adapter-claude messages). Parallelizable. NOTE: `display_pipeline.rs`
and `display_helpers.rs` are already `ported` in core-rs — these are **edits** to ported files.

---

## Cluster H — adapter model catalog alignment

Commit: `b717a3fe`(#441) (+ `08c03b16`#430 for codex probeModels). Keep probed catalogs
aligned with installed CLIs; drop invalid saved default models.

| File | Feature | What changed | Class | Rust target | Tests | Already handled |
|---|---|---|---|---|---|---|
| `claude/adapter.ts` (+36) | #441/#424/#430 | `enrichWithContextWindow` now reads per-entry `resolvedModel` (suffix on id OR resolvedModel) for 1M window + static-catalog fallback via resolved id; add `claude-sonnet-5` catalog entry (extended window); wire `generateTitle` (I) + `isTranscriptPresent` (E) | DAEMON-INTERNAL (feeds AdapterModel wire) | `mainframe-adapter-claude::adapter` | `claude/adapter-enrich.test.ts` (35), `claude/probe-models.test.ts` (64) | ported file exists; change absent |
| `claude/probe-models.ts` (+9) | #441 | `mapModelInfo` copies `resolvedModel`; `removeConcreteDefaultDuplicate` drops the concrete entry a `default` alias resolves to | DAEMON-INTERNAL | `mainframe-adapter-claude::probe_models` | `claude/probe-models.test.ts` | absent (probe_models = todo) |
| `settings/model-default.ts` NEW (9) | #441 | `normalizeSavedDefaultModel(configured, models)` — undefined when saved id not in catalog | DAEMON-INTERNAL | `mainframe-services::settings::model_default` (NEW) | `settings/model-default.test.ts` (21) | absent |
| `chat/lifecycle-manager.ts` (+12) | #441/#430 | default model normalized against live snapshot before use; title gen adapter-aware (`adapter.generateTitle` else keep deterministic) | DAEMON-INTERNAL | `mainframe-chat::lifecycle_manager` | (title-generation tests) | ported file exists; change absent |
| `server/routes/settings.ts` (+12) | #441 | `normalizeProviderDefaultModels` deletes invalid `defaultModel` per adapter on save | DAEMON-INTERNAL | `mainframe-server::routes::settings` | `routes/settings.test.ts` (+30), `settings-resolved-executable.test.ts` | absent |

Depends on A (`resolvedModel`). Shares `claude/adapter.ts`/`codex/adapter.ts` with I → one adapters stream.
Also touches: `__tests__/adapter-registry.test.ts` (+3), `title-generation.test.ts` (+7),
`title-generator-args.test.ts`, `title-dispatch.test.ts` (132) — title routing oracles (Cluster I).

---

## Cluster I — codex external sessions (disk import) + adapter-aware titles

Commit: `08c03b16`(#430). Codex sessions imported by scanning rollout JSONL on disk (not the
state DB); titles now generated by the owning adapter, so the generic title-gen was split out.

| File | Feature | What changed | Class | Rust target | Tests | Already handled |
|---|---|---|---|---|---|---|
| `codex/external-sessions.ts` NEW (208) | #430 | scan `~/.codex/sessions/YYYY/MM/DD/rollout-*-<uuid>.jsonl`; walk (depth 4), meta/prompt head reads (32K/192K), mtime+size caches, bounded pool (8), cwd-belongs-to-project filter, paginate | DAEMON-INTERNAL | `mainframe-adapter-codex::external_sessions` (NEW) | `codex/external-sessions.test.ts` (212) | absent |
| `codex/external-session-parse.ts` NEW (91) | #430 | `parseLines`, `firstUserPrompt` (skip preamble blocks, clean tags, 500 cap), `extractMeta` (session_meta cwd/git/ts + cwd regex fallback) | DAEMON-INTERNAL | `mainframe-adapter-codex::external_session_parse` (NEW) | (external-sessions.test.ts) | absent |
| `codex/adapter.ts` (+66/-...) | #430/#441/#424 | `listExternalSessions` delegates to disk scanner (removes `thread/list` RPC); `probeModels(exe)` + `loadModels(exe)`; `spawnTempAppServer(executable)`; `isTranscriptPresent` (E) | DAEMON-INTERNAL | `mainframe-adapter-codex::adapter` | `codex/list-models.test.ts` (+87) | absent (adapter = todo) |
| `codex/types.ts` (+22/-) | #430 | remove `ThreadListParams`/`ThreadSummary`/`ThreadListResult`; `CollaborationModeSettings.model` optional | DAEMON-INTERNAL | `mainframe-adapter-codex::types` | — | absent |
| `codex/turn-config.ts` (+4) | #430 | `modelId?: string`; omit `model` key when undefined | DAEMON-INTERNAL | `mainframe-adapter-codex::turn_config` | `codex/turn-config.test.ts` (+11) | absent |
| `codex/session.ts` (+2) | #430 | pass `pendingModel` (possibly undefined) not `?? ''` | DAEMON-INTERNAL | `mainframe-adapter-codex::session` | (codex-session.test.ts, 66) | absent |
| `claude/title-generator.ts` NEW (48) | #430 | `generateClaudeTitle(content,binary)` — one-shot Haiku CLI call (moved out of chat/title-generator) | DAEMON-INTERNAL | `mainframe-adapter-claude::title_generator` (NEW) | `title-dispatch.test.ts`, `title-generation.test.ts` | absent |
| `chat/title-generator.ts` (49→5) | #430 | strip `generateTitle`; keep only `deriveTitleFromMessage` | DAEMON-INTERNAL | `mainframe-chat::title_generator` | (title-generation.test.ts) | ported file exists; change absent |
| `claude/adapter.ts` | #430 | `generateTitle` → `generateClaudeTitle` — see H row | DAEMON-INTERNAL | `mainframe-adapter-claude::adapter` | — | absent |
| `chat/external-session-service.ts` | #430 | `adapter.generateTitle` gate — see E row | DAEMON-INTERNAL | `mainframe-chat::external_session_service` | — | absent |

Depends on A (`generateTitle` trait). Shares adapter files with H.

---

## Cluster J — session context panel dedup (paths/skills/CLAUDE.md)

Commit: `48de6cdc`(#432). Dedupe context files + skills; extract Claude context-file collection
into a testable module using absolute global paths.

| File | Feature | What changed | Class | Rust target | Tests | Already handled |
|---|---|---|---|---|---|---|
| `chat/context-tracker.ts` (+110) | #432 | `dedupeContextFiles` (per-list path dedup + drop project file resolving to a global one; `toAbsoluteContextPath` `~`/rel resolution); `dedupeSkillFiles` (path dedup then on-disk existence tie-break within same display-name group); `getSessionContext` uses both. `SessionContext` shape unchanged | DAEMON-INTERNAL | `mainframe-chat::context_tracker` | `chat/context-tracker.test.ts` (141) | ported file exists; change absent |
| `claude/context-files.ts` NEW (53) | #432 | `collectClaudeContextFiles(projectPath,homeDir?)` — global `~/.claude/{CLAUDE,AGENTS}.md` as ABSOLUTE paths (so GET /files whitelists + distinguishes from same-named project file); project relative | DAEMON-INTERNAL | `mainframe-adapter-claude::context_files` (NEW) | `claude/context-files.test.ts` (41) | absent |
| `claude/session.ts` (+32/-) | #432 | `getContextFiles` delegates to `collectClaudeContextFiles` (was inline, used relative global path) | DAEMON-INTERNAL | `mainframe-adapter-claude::session` | (context-files.test.ts) | ported file exists; change absent |

Depends on existing `ContextFile`/`SkillFileEntry` types. Independent of other clusters.

---

## Cluster K — reliable live file-watch (re-arm on atomic save)

Commit: `f2fa02c9`(#433). (The ws-client boot-race half of #433 is UI.)

| File | Feature | What changed | Class | Rust target | Tests | Already handled |
|---|---|---|---|---|---|---|
| `files/file-watcher.ts` (+48) | #433 | on `rename` event (atomic rename-over replaces inode → kernel watch goes silent) `rearm()`: close + re-open watcher, retry once after 100ms if path briefly absent, else cleanup; `openWatcher` extracted | DAEMON-INTERNAL | `mainframe-services::files::file_watcher` | `file-watcher-rearm.test.ts` (122) | ported file exists (`notify`); rearm semantics absent — VERIFY vs `notify` rename events |

Independent. NOTE the Rust port uses `notify`, not `fs.watch` — re-arm-on-rename must be
reproduced as equivalent behavior so the `file.changed` WS event fires on the same triggers.

---

## Cluster L — read-only external files + base64

Commit: `a5afda52`(#436). (The serialized child-webview IPC + `reanchor` half is Tauri/Electron
UI — NON-DAEMON; only `types/host/host-bridge.ts` in Cluster A.)

| File | Feature | What changed | Class | Rust target | Tests | Already handled |
|---|---|---|---|---|---|---|
| `server/routes/files.ts` (+22) | #436 | external-file route accepts `encoding=base64` query → returns `{path,content(base64),encoding:'base64'}` with 10MB limit (else 2MB utf-8); blocklist adds `.aws/credentials`, `.netrc`, `.gnupg/` | WIRE (query param + response field) | `mainframe-server::routes::files` | `routes/files.test.ts` (72) | absent |

Independent. Parallelizable.

---

## NON-DAEMON / skipped (no Rust port)

| Item | Why skipped |
|---|---|
| `48218b7e` provider logos in sidebar (#416) | Feature is UI (`ui`/app-*); only a core **test** changed (`server/__tests__/websocket-broadcast-gating.test.ts` +29 — a broadcast-gating assertion). No production daemon change. |
| `types/host/host-bridge.ts` `reanchor?` (#436) | Desktop-shell (Tauri/Electron) bridge contract; the daemon does not consume it. Port to `host_bridge.rs` only for type completeness (low-priority per PORTING §2.1). |
| ws-client boot race (`f2fa02c9`#433, UI half) | Lives in `ui`. |
| serialized child-webview IPC (`a5afda52`#436, UI half) | Lives in `app-tauri`/`app-electron`. |
| `chore: version packages / prepare release` commits (`646bcf91`,`3b4878a7`,`b6de3d47`,`fcd4e4f1`,`dfe0675b`,`5798c19e`) | Version bumps only; no daemon/wire logic. |

## Test oracles (port assertion-for-assertion)

New/changed `__tests__` that become the port oracle, by cluster: **B** child-registry(142),
sweep(325), resolve-cloudflared(53), tunnel-manager(+175), launch-manager-tracking(183),
launch-reap-integration(70), server-start-error(45); **C** cors-origin(68); **D**
claude-events(70), event-handler(94), db/transcript-missing(83); **E** degraded-recovery(139),
transcript-presence(117), external-session-sweep(47), chat-manager-degraded(103),
claude/transcript(34), codex/transcript(58), routes/chat-recovery(86), chats-messages(28);
**F** tracker(+95), liveness(+21), task-events(59), task-events-integration(35),
event-handler-background-activity(113), chat-manager-background-activity(121); **G**
tool-grouping(+104), display-pipeline(144); **H** adapter-enrich(35), probe-models(64),
model-default(21), routes/settings(+30), title-generation(+7), title-generator-args,
adapter-registry(+3); **I** codex/external-sessions(212), list-models(+87), turn-config(+11),
codex-session(66), context-files(41), title-dispatch(132); **J** context-tracker(141),
context-files(41); **K** file-watcher-rearm(122); **L** routes/files(72). Plus
`types/__tests__/background-activity.test.ts`(93) for Cluster A.
