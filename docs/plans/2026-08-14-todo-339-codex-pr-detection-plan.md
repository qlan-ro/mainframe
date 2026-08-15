# Codex sessions never detect PRs — implementation plan (todo #339)

## Goal

PR detection today is a Claude-adapter feature: the parsing and classification code lives in
`mainframe-adapter-claude::pr_detection`, the live scan runs inside the Claude adapter's own NDJSON
handlers against Claude-internal session state, and the daemon's cold-load rescan reaches into the Claude
crate for the parser. Codex has no PR-scanning code, so a Codex session that opens a pull request shows no
PR anywhere, ever. This plan lifts the parser and both scan policies into an adapter-neutral module in
`mainframe-adapter-api`, moves live detection to the one seam every adapter already crosses — the
`SessionSink` returned by `event_handler::build_sink` — and fixes the cold-load rescan for Codex by
sourcing its scan records from the rollout JSONL instead of `thread/read`, which (verified below) never
returns command executions. The Claude path keeps its exact gating, `created`/`mentioned` classification
and Path-A/Path-B semantics; the heuristics move, they are not redesigned. Detection stays pure text
analysis: no `gh`, no `git`, no network.

## Root cause of the cold-load miss (paste-ready for the PR description)

The brief listed three candidate causes. Two are refuted and one is confirmed:

- **Refuted — the second session construction.** `scan_loaded_history` really does build a second Codex
  session and load history again (`chat_deps.rs:152-165`), and that second load succeeds. It is wasteful
  (a second temp `codex app-server` spawn per activation), not broken.
- **Refuted — the silently discarded error.** `CodexSession::load_history` never returns `Err`; both
  failure paths log a `warn!` and return `Ok(vec![])` (`session.rs:739-753`).
- **Confirmed — the loaded Codex history carries no command output.** Codex history for the parent thread
  comes from the app-server's `thread/read` (`history_load.rs:25-31`). On codex-cli 0.147.0 `thread/read`
  returns only `userMessage`, `agentMessage`, `fileChange` and `webSearch` items — never
  `commandExecution` (and never `reasoning`). Probed on four real threads, including one created seconds
  earlier with `persistExtendedHistory: true` / `persistFullHistory: true`, whose live stream had just
  emitted a `commandExecution` for the same command. So `convert_thread_items` produces no `Bash` tool_use
  and no `tool_result`, and `scan_history_for_prs` (`chat_deps.rs:1060`) has nothing to scan. The scan is
  adapter-agnostic and correct; its input is empty.

The fix therefore has two halves: live detection at the sink seam (which works for Codex, because the live
stream *does* carry `commandExecution` with `command` + `aggregatedOutput`), and a Codex-specific scan
*source* — the rollout JSONL the adapter already knows how to read — for the cold-load rescan. No PR
parsing moves into the Codex crate; the crate only supplies canonical tool-use/tool-result records.

## Established facts

Every line was verified while planning. Downstream implementers and reviewers should trust these rather
than re-deriving them. Probe scripts referenced as `probe` were run against the local `codex` binary
(codex-cli 0.147.0) and the user's real `~/.codex` data; they are reproducible with the commands quoted.

| Fact | Receipt |
| --- | --- |
| `thread/read {threadId, includeTurns:true}` returns no `commandExecution` and no `reasoning` items. Item counts for four threads: `019ff4ce` → agentMessage 17, fileChange 6, userMessage 2, webSearch 1 (its rollout holds 52 exec calls); `019fee1f` → agentMessage 11, userMessage 1, fileChange 1 (34 `exec_command` calls); `019e2c7d` (May 2026, the chat that *does* hold PRs) → agentMessage 46, userMessage 11, fileChange 10; `019fff69` (created during planning, persist flags on) → agentMessage 2, userMessage 1. | probe: spawn `codex app-server`, `initialize` → `initialized` → `thread/read`; outputs saved at `/tmp/mf339_threadread{,2,3,4}.json` |
| The **live** app-server emits `item/completed` with `{"type":"commandExecution", "command":"/bin/zsh -lc 'echo …'", "aggregatedOutput":"…", "exitCode":0, "source":"unifiedExecStartup"}` — including for the new unified exec tool. Live Codex therefore does reach the canonical stream. | probe on thread `019fff69`, one real turn ("Run the shell command: echo mainframe-probe-339") |
| Codex renders that live item as a canonical `Bash` tool_use plus a tool_result carrying `aggregated_output`. | `mainframe-adapter-codex/src/thread_item_render.rs:113-124` |
| Codex's history conversion produces the same canonical pair — `ChatMessageType::Assistant` + `tool_use_block(id,"Bash",bash_input(command))`, then `ChatMessageType::ToolResult` + `tool_result_block(id, aggregated_output, …)`. | `mainframe-adapter-codex/src/history_convert.rs:55-73` |
| The modern Codex shell tool writes `{"type":"custom_tool_call","name":"exec","call_id":…,"input":"const r = await tools.exec_command({\"cmd\":\"gh pr create …\",\"workdir\":…}); text(r.output);"}` to the rollout, and its output record is `{"type":"custom_tool_call_output","call_id":…,"output":[{"type":"input_text","text":"Script completed…"},{"type":"input_text","text":"https://github.com/…/pull/614\n"}]}` — `output` is an **array**, not a string. | rollout `~/.codex/sessions/2026/08/14/rollout-…-019fff69….jsonl` and `…/2026/08/12/rollout-…-019ff4ce….jsonl` |
| `RolloutPayload.output` is typed `Option<String>`, so an array-shaped `custom_tool_call_output` fails `serde_json::from_str::<RolloutLine>` and the whole line is skipped. `handle_custom_tool_call` only recognizes `apply_patch`; `handle_function_call` only recognizes `exec_command`. The unified exec tool is therefore invisible to the rollout reader today. | `mainframe-adapter-codex/src/rollout_reader.rs:50-74,180-190`; `rollout_reconstruct.rs:143-160,206-228` |
| Reconstructing the unified-exec pair from the real rollout yields command `gh pr create --base main --head fix/prerelease-update-pill …` and output `https://github.com/qlan-ro/mainframe/pull/614` — exactly the pair the neutral scan needs. | probe over rollout `019ff4ce` (brace-matched JSON after `tools.exec_command(`, `output[].text` joined) |
| Codex's own state DB maps a **parent** thread id to its rollout path: `~/.codex/state_5.sqlite`, table `threads`, column `rollout_path`. `lookup_agent_metadata(&[thread_id])` already reads it and is test-injectable via `ThreadRegistryDeps { db_path }`. | `mainframe-adapter-codex/src/thread_registry.rs:19,22-24,37-45`; `sqlite3 ~/.codex/state_5.sqlite "SELECT id, rollout_path FROM threads WHERE id='019ff4ce-…'"` returns the file |
| `read_rollout_items` already re-derives `commandExecution`/`fileChange`/`mcpToolCall` items from a rollout and validates the path (must live under `~/.codex/sessions/`, filename must embed the thread id). | `mainframe-adapter-codex/src/rollout_reader.rs:84-104,105-137` |
| Chat `kEIpCdjD3FR2SK7e9x-D8` (thread `019ff4ce-845c-7492-8cef-8efb04ac6885`) has `detected_prs = []` today and its rollout contains `gh pr create` plus PR 614 — the manual-QA repro case. | `sqlite3 -readonly ~/.mainframe/mainframe.db "SELECT id, claude_session_id, detected_prs FROM chats WHERE adapter_id='codex' ORDER BY created_at DESC"` |
| The Claude live path scans the *raw* tool_result text via `extract_tool_result_content`, and the canonical `on_tool_result` blocks are built by `build_tool_result_blocks` **using that same function** — so a sink-level scan sees byte-identical text. | `mainframe-adapter-claude/src/user_event.rs:426` vs `history_tool_result.rs:50-73,96-109` |
| Claude subagent tool_results never reach `on_tool_result`: `handle_user_event` routes them to `handle_subagent_user_event` and returns before the PR block. A sink decorator that ignores `on_subagent_child` therefore changes nothing. | `mainframe-adapter-claude/src/user_event.rs:369-376` |
| The live Claude Path A gate is tool-name + command text only (`Bash`/`BashTool` with a `gh pr`/`glab mr`/`az repos pr` command, or `Agent`/`Task`) — expressible with no Claude-internal types. | `mainframe-adapter-claude/src/pr_detection.rs:164-185` |
| `ClaudeSessionState.tool_use_registry` has exactly three consumers, all PR-detection: the insert (`assistant_event.rs:149`), the Path-A lookup (`user_event.rs:434`) and the eviction (`user_event.rs:466`). Nothing else reads it. | `grep -rn "tool_use_registry" packages/core-rs/crates/mainframe-adapter-claude/src` |
| There is **no** existing test for the Claude *live* PR path — the recording sink has a `prs` field that no assertion reads. Only the pure-parser tests exist (in `pr_detection.rs`'s own `mod tests`) plus four history-scan tests in `chat_deps.rs`. | `mainframe-adapter-claude/src/events.rs:480,541`; `chat_deps.rs:1275-1327` |
| `build_sink` is the single construction point for the live sink, and every adapter receives it through `session.spawn(..., Some(sink))`. | `mainframe-chat/src/event_handler.rs:209-226`; `mainframe-chat/src/lifecycle_manager.rs:998,1013-1025` |
| `on_pr_detected` persists then emits, and `add_detected_prs` already dedupes by URL and upgrades `mentioned` → `created`, returning only newly written or upgraded rows. Acceptance criterion 2 needs tests, not code. | `mainframe-chat/src/event_handler.rs:1161-1172`; `mainframe-db/src/chats.rs:537-572` |
| The mock adapter replays recorded sink calls, including `onMessage` / `onToolResult`, so anything wrapped around `build_sink` applies to it too. | `mainframe-adapter-mock/src/dispatch.rs:49` and its neighbours |
| `mainframe-adapter-api` depends only on `mainframe-types` and is a dependency of `mainframe-chat`, `mainframe-server`, and all three adapter crates — the only crate that can host shared detection without a new workspace member. | `packages/core-rs/crates/*/Cargo.toml` |
| `#332` ("live thread doesn't detect PR", the client-side subscriber) **has merged** and is this branch's base commit, so the live user-visible criterion is now verifiable. | `git log --oneline -1` → `67bbe2e3 fix(ui): reload sessions list on live PR detection (#332) (#639)` |
| `docs/plans/` is gitignored; this plan is committed with `git add -f`. | `.gitignore:53` |
| Daemon-only, user-visible changes take a `'@qlan-ro/mainframe-ui': patch` changeset (ui/types are lockstepped and the release tags from them). | `.changeset/config.json` (`fixed`), `.changeset/mock-adapter-background-tasks.md` |
| Observed, out of scope: `ThreadStartParams` in codex-cli 0.147.0's generated schema has no `persistExtendedHistory` / `persistFullHistory` fields, yet Mainframe still sends both. They are silently ignored. | `codex app-server generate-ts --out /tmp/mf339ts` → `v2/ThreadStartParams.ts`; `mainframe-adapter-codex/src/session.rs:184-185` |

## Design decisions

**D1 — neutral home is `mainframe-adapter-api::pr_detection`, not a new crate.** It depends only on
`mainframe-types`, every consumer already depends on it, and the sink decorator belongs next to the
`SessionSink` trait it implements. No adapter crate owns detection afterwards, and `chat_deps.rs` stops
importing from `mainframe_adapter_claude`.

**D2 — one parser set, two scan policies.** The live scan keeps its tool gating and Path-A/Path-B split;
the cold-load scan keeps its ungated walk and its dedupe-by-owner/repo/number. Unifying them would change
behavior — e.g. `scan_history_for_prs_marks_source_mentioned_without_a_matching_pending_create`
(`chat_deps.rs:1294`) passes a tool_result whose tool_use was never registered, which the live gate would
reject. The brief's out-of-scope line is explicit: "Changing the detection heuristics themselves … Move
them; do not redesign them." Acceptance criterion 5 asks for one *parsing/classification* implementation;
after this change both policies call the same parser functions, and neither lives in an adapter crate.

**D3 — live detection is a `SessionSink` decorator applied in `build_sink`.** One wrap point, every
adapter, no adapter-side code. It observes `on_message` for tool_use blocks (recording name + `command`)
and `on_tool_result` for results, then calls the inner sink's `on_pr_detected`. It delegates every other
callback untouched, including `on_subagent_child`.

**D4 — the cold-load scan source becomes `AdapterSession::load_scan_records`, defaulting to
`load_history`.** Claude and the mock inherit today's behavior verbatim. Codex overrides it with an
offline rollout read, which also removes the second temp app-server spawn on Codex chat activation. The
transcript rendering path is untouched: this plan does **not** change what a reloaded Codex chat displays.

**D5 — `session_for_scan` stays.** It still supplies `extract_plan_files` / `extract_skill_files`, which
Claude needs. Only the history source inside `scan_loaded_history` changes.

**D6 — no backfill sweep.** Per the brief: reopening a Codex chat backfills it once the rescan works.

## Acceptance-criteria disposition

| Criterion | How it is met |
| --- | --- |
| Codex PR-create → `created` on the chat + `chat.prDetected` | Live: task 12 (decorator) + task 13 (wiring); Codex's live `commandExecution` is already canonical (facts 2-3). Cold load: tasks 15-17. Tests: 8, 9, 20. |
| PR URL with no matching create → `mentioned`; no duplicate; `mentioned` → `created` upgrades | Classification: task 12 (live) / task 4 (history, moved as-is). Dedupe + upgrade already in `chats.rs:537-572`; pinned by task 20. |
| Cold load persists the PR, and the PR explains why it did not before | Tasks 15-17; the root-cause paragraph above is written for the PR description. |
| Claude path unchanged (gating, classification, all URL variants, failed-mutation case) | Parser moves verbatim (task 1); the decorator re-expresses Path A/B in tool-name + command terms (task 12); red-phase specs in task 8 cover gating, `Agent`/`Task`, GitLab/Azure/Azure-JSON/compact refs and the failed mutation. |
| Exactly one parsing/classification implementation; no PR scanning in any adapter crate; daemon does not import from an adapter crate | Tasks 1-3 (move + delete), task 14 (delete the Claude in-adapter scan and its dead state). Verified by task 21's grep. |
| Neutral-layer unit tests, Claude-shaped and Codex-shaped input, identical output | Task 8 (parity test) + task 9 (mock adapter inherits detection). |
| No process spawn, no network | The parser is pure; the Codex scan source reads two local files (`state_5.sqlite`, the rollout). Task 21 asserts the review checklist. |
| No `@ts-ignore`, no silent catches, 300-line files, 50-line functions, changeset | File split is specified per task; every new failure path logs (tasks 12, 16); task 22 ships the changeset. |

## Constraints carried from CLAUDE.md and the repo

- Max 300 lines per file, 50 per function. `pr_detection.rs` is 676 lines with tests, so the move splits it
  into four source files plus integration tests under `crates/mainframe-adapter-api/tests/`.
- No `regex` crate in the workspace allowlist — the hand-rolled matchers move verbatim, they are not
  rewritten.
- No silent catches: every new failure path logs through `tracing` with a `module = "…"` field, matching
  the surrounding code.
- `chat_deps.rs` is already 1733 lines (pre-existing violation). This plan only removes lines from it.
- Run single test binaries, not the whole suite: `cargo test -p <crate> --test <name>`.

---

## Task groups

### Group A — neutral-pr-module (core)

Moves detection into `mainframe-adapter-api` and adds the scan-source seam. Everything downstream compiles
against the new paths after this group.

**Task 1 — move the parser into `mainframe-adapter-api::pr_detection`.**
Create, copying the bodies verbatim from
`packages/core-rs/crates/mainframe-adapter-claude/src/pr_detection.rs`:
- `packages/core-rs/crates/mainframe-adapter-api/src/pr_detection.rs` — module doc + `pub use` of the
  submodules + `DetectedPrCore` and its `with_source`.
- `packages/core-rs/crates/mainframe-adapter-api/src/pr_detection/text.rs` — `is_word_char`,
  `boundary_at`, `read_segment`, `read_digits`, `has_word_sequence`, `has_word_sequence_trailing_ws`,
  `match_word_sequence`, `TrailingBoundary`, `scan_prefix`.
- `.../pr_detection/parse.rs` — `try_github`/`parse_pr_url`, `try_gitlab`/`parse_gitlab_mr_url`,
  `try_azure`/`parse_azure_pr_url`, `parse_azure_pr_json` + its three JSON helpers,
  `extract_pr_from_tool_result`.
- `.../pr_detection/command.rs` — `is_pr_create_command`, `is_pr_mutation_command`, `pr_relevant_bash`,
  `ToolUseMeta`, `should_scan_tool_result_for_pr`, `gh_compact_ref`, `parse_pr_identifier_from_args`.
Declare `pub mod pr_detection;` in `packages/core-rs/crates/mainframe-adapter-api/src/lib.rs`.
Also add `serde_json = { workspace = true }` to `[dependencies]` in
`packages/core-rs/crates/mainframe-adapter-api/Cargo.toml`, which has no `serde_json` entry today. The
crate needs it from task 10 on (`observe_tool_use` takes `&HashMap<String, serde_json::Value>`, the type
`MessageContentNode::ToolUse.input` already carries) and every new test file under `tests/` needs it to
build fixtures. One `[dependencies]` entry covers both: Cargo compiles integration tests against the
crate's normal dependencies as well as its dev-dependencies — `mainframe-adapter-codex` lists `serde_json`
only under `[dependencies]` and `tests/rollout_reader.rs` does `use serde_json::json;`. No
`[dev-dependencies]` section is needed here.
Do not change a single matcher. Keep the `PORT STATUS` footer on the `pr_detection.rs` module file,
amended with a one-line note that it moved here from the Claude crate for todo #339.
*Verify:* `cargo check -p mainframe-adapter-api`; each new file under 300 lines (`wc -l`).

**Task 2 — move the parser's tests.**
Move the whole `#[cfg(test)] mod tests` block from the old `pr_detection.rs` into
`packages/core-rs/crates/mainframe-adapter-api/tests/pr_detection_parse.rs`, unchanged assertion for
assertion, with `use mainframe_adapter_api::pr_detection::*;`.
*Verify:* `cargo test -p mainframe-adapter-api --test pr_detection_parse` — all 24 tests pass.

**Task 3 — delete the Claude copy and repoint every import.**
Delete `packages/core-rs/crates/mainframe-adapter-claude/src/pr_detection.rs` and its `pub mod`
declaration (`lib.rs:36`). Repoint:
- `mainframe-adapter-claude/src/assistant_event.rs:16`
- `mainframe-adapter-claude/src/user_event.rs:18`
- `mainframe-adapter-claude/src/session.rs:51`
- `mainframe-adapter-claude/src/messages/display_helpers.rs:590` (test import)
- `mainframe-server/src/chat_deps.rs:32`
…to `mainframe_adapter_api::pr_detection::{…}`.
*Verify:* `cargo check -p mainframe-adapter-claude -p mainframe-server`; `grep -rn "pr_detection" packages/core-rs/crates/mainframe-adapter-claude` returns nothing.

**Task 4 — move the history scan into the neutral module.**
Move `scan_history_for_prs` (`chat_deps.rs:1060-1112`) verbatim to
`packages/core-rs/crates/mainframe-adapter-api/src/pr_detection/history.rs` as
`pub fn scan_history_for_prs(history: &[ChatMessage]) -> Vec<DetectedPr>`; `chat_deps.rs:175` calls the
neutral function. Move its four tests (`chat_deps.rs:1275-1327`) into
`packages/core-rs/crates/mainframe-adapter-api/tests/pr_detection_history.rs` and **copy** — do not move —
the `text_msg`/`tool_use_msg`/`tool_result_msg` fixture builders (`chat_deps.rs:1219-1274`) into that new
file. The `chat_deps.rs` copies stay: tests this task leaves behind still call them
(`text_msg` at `chat_deps.rs:1354,1370,1382` in `scan_history_for_mentions_*`, `tool_result_msg` at
`chat_deps.rs:1513` in `scan_and_persist_prs_persists_a_new_pr_and_emits_chat_pr_detected`), and moving
them stops `mainframe-server` compiling. Leave the `scan_history_for_mentions` tests where they are — they
are unrelated.
After this task `tool_use_msg` has no caller in `chat_deps.rs` until task 19 adds one in the same module.
`dead_code` is a warning, not an error (`packages/core-rs/Cargo.toml` denies only `clippy::unwrap_used` /
`expect_used`), so this task's verify still passes and task 20's `-D warnings` gate runs after task 19
restores the caller. Do not delete the helper and do not silence the warning with `#[allow(dead_code)]`.
*Verify:* `cargo test -p mainframe-adapter-api --test pr_detection_history` (4 tests pass);
`cargo test -p mainframe-server --lib scan_loaded_history_tests` still green (expect one `dead_code`
warning on `tool_use_msg`).

**Task 5 — add the `load_scan_records` seam.**
In `packages/core-rs/crates/mainframe-adapter-api/src/adapter.rs`, next to `load_history` (line 165), add:
```rust
/// Canonical tool-use/tool-result records for transcript scanning (PR
/// detection). Defaults to `load_history`; Codex overrides it because its
/// app-server's `thread/read` never returns `commandExecution` items
/// (codex-cli 0.147.0), so its loaded history carries no command output.
fn load_scan_records(&self) -> BoxFuture<'_, Result<Vec<ChatMessage>, AdapterError>> {
    self.load_history()
}
```
No call-site changes yet.
*Verify:* `cargo check --workspace --manifest-path packages/core-rs/Cargo.toml`; `cargo fmt --check`.

### Group B — live-detection specs, red phase (test)

New test files only. **These tests do not compile until Group C lands** (`PrDetectionSink` does not exist
yet) — that is the intended red phase; record "does not compile / listed failures" as the expected
verification output, and do not weaken the specs to make them build.

Tasks 6, 7 and 8 all write `crates/mainframe-adapter-api/tests/pr_detection_sink.rs`, so **this group runs
sequentially** (6 → 7 → 8); only task 9 touches a different file. Task 6 creates the file and its recording
inner sink; tasks 7 and 8 append to it.

**Task 6 — decorator behavior spec, Claude-shaped input.**
`packages/core-rs/crates/mainframe-adapter-api/tests/pr_detection_sink.rs`: a recording inner sink, then
drive `PrDetectionSink` with canonical blocks and assert the emitted `DetectedPr`s:
- `Bash` tool_use `gh pr create --title x` (id `tu1`) → tool_result `tu1` "Created https://github.com/acme/repo/pull/7" ⇒ one PR, `source: created`.
- tool_result on a `Bash` tool_use whose command is `gh pr view 42` ⇒ PR URL in the output yields `mentioned` (the gate passes; the create does not).
- tool_result on a `Bash` tool_use whose command is `npm test` ⇒ nothing emitted (gate rejects).
- tool_result whose tool_use was `Read` ⇒ nothing emitted.
- tool_result on an `Agent` and on a `Task` tool_use containing a PR URL ⇒ `mentioned` (gate accepts by name).
- tool_result with **no** registered tool_use ⇒ nothing emitted.
- `gh pr ready org/repo#42` (id `tu2`) → non-error tool_result ⇒ `mentioned` with the reconstructed URL.
- the same mutation with `is_error: true` ⇒ nothing emitted.
- GitLab MR URL, Azure PR URL and an Azure PR JSON payload each yield the right owner/repo/number.

**Task 7 — decorator parity spec, Codex-shaped input.**
Same file: build the Codex-shaped pair the way `thread_item_render.rs:113-124` does — tool_use `Bash`
with `command = "/bin/zsh -lc 'gh pr create --base main …'"`, then a tool_result whose text is the
aggregated output containing `https://github.com/qlan-ro/mainframe/pull/614` — and assert the emitted
`DetectedPr` is **equal** to the one produced by the Claude-shaped fixture for the same URL. One assertion
comparing the two vectors; this is acceptance criterion 6.

**Task 8 — tool-meta eviction spec.**
Same file: after a tool_result is consumed, a second tool_result reusing the same `tool_use_id` with a
different PR URL emits nothing (the meta was evicted, mirroring `user_event.rs:465-467`).

**Task 9 — "any adapter inherits detection" spec.**
`packages/core-rs/crates/mainframe-adapter-mock/tests/pr_detection_replay.rs`, driving the crate's **public**
surface — `dispatch` is private and `emit_event` is `pub(crate)` (`mock/src/dispatch.rs:23,29`), so the test
must not name either. Follow `crates/mainframe-adapter-mock/tests/replay.rs` (the
`preserves_fixture_order_when_delays_hit_the_cap` case): build the fixture lines inline with
`serde_json::json!` — a `{"dir":"in","method":"sendMessage","args":[],"delayMs":0}` marker, then
`{"dir":"out","method":"onMessage","args":[[<Bash tool_use block, command "gh pr create --title x", id
"tu1">], null],"delayMs":0}` and `{"dir":"out","method":"onToolResult","args":[[<tool_result block for
"tu1" containing https://github.com/acme/repo/pull/7>]],"delayMs":0}` — then
`ReplaySession::new(options, parse_fixture(&lines.join("\n")).unwrap())`,
`session.spawn(None, Some(Arc::new(PrDetectionSink::new(inner.clone())))).await`, `send_message`, a short
sleep, and assert `inner` recorded exactly one `on_pr_detected` with `source: created`.
The trailing `null` on the `onMessage` args is required, not cosmetic: `dispatch` reads
`arg::<Option<MessageMetadata>>(event, 1)` and `arg()` errors on a missing index rather than defaulting to
`None` (`mock/src/dispatch.rs:14-21,31-34`), so a one-element `args` makes `emit_event` drop the whole
event and no tool_use ever registers. `tests/fixtures/replay.ndjson:4` is the shape to copy.
`onToolResult` takes one argument.
The fixture must
contain **no** `onPrDetected` event: the decorator delegates that call straight through, so a recorded one
would satisfy the assertion without any detection happening. This is the brief's "asserted by a test
driving the mock adapter".
*Verify (tasks 6-9):* `cargo test -p mainframe-adapter-api --test pr_detection_sink` and
`cargo test -p mainframe-adapter-mock --test pr_detection_replay` — expected to fail to compile with
"cannot find type `PrDetectionSink`" until Group C.

### Group C — live detection at the sink seam (core)

**Task 10 — the shared live scanner.**
`packages/core-rs/crates/mainframe-adapter-api/src/pr_detection/live.rs`: `LivePrScanner` holding
`tool_meta: HashMap<String, (String /*name*/, Option<String> /*command*/)>`,
`pending_creates: HashSet<String>` and `pending_mutations: HashMap<String, DetectedPrCore>`, with:
- `observe_tool_use(&mut self, id: &str, name: &str, input: &HashMap<String, Value>)` — records the meta;
  for `Bash`/`BashTool` also registers a pending create (`is_pr_create_command`) and a pending mutation
  (`is_pr_mutation_command` + `parse_pr_identifier_from_args`). Mirrors `assistant_event.rs:143-172`.
- `observe_tool_result(&mut self, tool_use_id: &str, text: &str, is_error: bool) -> Vec<DetectedPr>` —
  Path A (`should_scan_tool_result_for_pr` over the recorded meta, then `extract_pr_from_tool_result`,
  `created` when the id was a pending create else `mentioned`), then Path B (a stashed mutation on a
  non-error result → `mentioned`), then evicts the id's meta. Mirrors `user_event.rs:433-467`.
Keep both methods under 50 lines; split the two paths into private helpers if needed.

**Task 11 — the decorator.**
`packages/core-rs/crates/mainframe-adapter-api/src/pr_detection/sink.rs`:
`pub struct PrDetectionSink { inner: Arc<dyn SessionSink>, state: Mutex<LivePrScanner> }` with
`pub fn new(inner: Arc<dyn SessionSink>) -> Self`. Implement `SessionSink`:
- `on_message`: walk the blocks for `MessageContentNode::ToolUse { id, name, input, .. }` →
  `observe_tool_use`; then `self.inner.on_message(...)`.
- `on_tool_result`: walk for `MessageContentNode::ToolResult { tool_use_id, content, is_error, .. }` →
  collect from `observe_tool_result`; call `self.inner.on_tool_result(...)` first, then
  `self.inner.on_pr_detected(pr)` for each hit (persist-then-emit ordering already lives in the inner
  sink).
- every other method (including `on_subagent_child`, `on_pr_detected`, and the defaulted
  `on_trust_required` / `on_provider_quota` / `on_attention_request` / `on_permission_cancelled`):
  straight delegation.
Never hold the state lock across an inner-sink call. Poisoned-lock recovery follows the repo idiom
(`unwrap_or_else(|e| e.into_inner())`).
*Verify:* Group B's tests now pass: `cargo test -p mainframe-adapter-api --test pr_detection_sink`.

**Task 12 — wire it into `build_sink`.**
`packages/core-rs/crates/mainframe-chat/src/event_handler.rs:214` — wrap the constructed
`SessionSinkImpl` in `PrDetectionSink` before returning:
`Arc::new(PrDetectionSink::new(Arc::new(SessionSinkImpl { … })))`. Add a one-line comment saying detection
is adapter-neutral and lives here so every adapter inherits it. Add one in-crate wiring test (new module
file `packages/core-rs/crates/mainframe-chat/src/event_handler/pr_detection_wiring_tests.rs`, declared
next to the existing `attention_tests` / `worktree_trigger_tests` modules) that drives the sink returned by
`build_sink` with a Bash create + PR-URL result and asserts `add_detected_prs` was called and
`DaemonEvent::ChatPrDetected` was emitted, using the existing chat test doubles.
*Verify:* `cargo test -p mainframe-chat pr_detection_wiring`.

**Task 13 — delete the Claude in-adapter live scan and its dead state.**
- `user_event.rs:433-467`: remove the Path A block, the Path B block and the registry eviction; keep
  `link_launch` and the plan-file capture untouched.
- `assistant_event.rs:161-172`: remove the `pending_pr_creates` / `pending_pr_mutations` registration and
  the now-unused `pr_detection` import.
- `assistant_event.rs:143-159`: `tool_use_registry.insert` — the established facts confirm PR detection is
  its only consumer, so delete the insert, the `tool_use_registry` field (`session.rs:211`), its init
  (`session.rs:379`) and `ToolUseRegistryEntry` (`session.rs:159`). Keep `st.task_events.capture_tool_use`,
  which is independent. Re-run the grep before deleting; if anything else reads it, leave the field with a
  one-line comment naming the consumer and say so in the PR.
- `session.rs:209-210,377-378`: delete `pending_pr_creates` / `pending_pr_mutations` and their inits.
*Verify:* `cargo test -p mainframe-adapter-claude` (all existing suites green — the events/user-event tests
never asserted on PRs); `cargo clippy -p mainframe-adapter-claude -- -D warnings` (no dead-code warnings).

### Group D — Codex scan-source specs, red phase (test)

New test files only. Task 14 compiles today and fails on behavior. Task 15 does **not** compile until task
17 lands — it names the `CodexScanDeps` test seam that task 17 introduces — so its red phase is a compile
error, same contract as Group B. Record that as the expected verification output; do not weaken the spec
to make it build.

**Task 14 — unified-exec rollout reconstruction spec.**
`packages/core-rs/crates/mainframe-adapter-codex/tests/rollout_unified_exec.rs`: write a fixture rollout
JSONL into a `tempfile::TempDir` shaped like the real one (a `custom_tool_call` `name:"exec"` whose
`input` is `const r = await tools.exec_command({"cmd":"gh pr create --title x","workdir":"/tmp"}); text(r.output);`,
followed by a `custom_tool_call_output` whose `output` is
`[{"type":"input_text","text":"Script completed\nOutput:\n"},{"type":"input_text","text":"https://github.com/acme/repo/pull/7\n"}]`),
then assert `read_rollout_items` returns a `ThreadItem::CommandExecution` with
`command == "gh pr create --title x"` and an `aggregated_output` containing the PR URL. Add cases for:
`cmd` given as an array of strings (joined with spaces); a malformed `input` with no parsable
`tools.exec_command({…})` (the pair is skipped, no panic, and neighbouring records still parse); a
string-shaped `output` on an `apply_patch` `custom_tool_call_output` still producing its `FileChange`
(regression guard for the widened field).
Note: `read_rollout_items` validates the path, so the fixture file must be named
`rollout-<anything>-<threadId>.jsonl`; use the existing test's approach in
`mainframe-adapter-codex/tests/rollout_reader.rs` for the containment rule, or pass
`expected_thread_id: None` where that suffices.

**Task 15 — Codex `load_scan_records` spec.**
`packages/core-rs/crates/mainframe-adapter-codex/tests/load_scan_records.rs`. Build the session through the
task-17 seam — the production entry points take no injection (`lookup_agent_metadata` hardcodes `None`
deps, `thread_registry.rs:37-39`; `read_rollout_items` with `deps: None` enforces containment under the
real `~/.codex/sessions`, `rollout_reader.rs:88-93,105-136`):

```rust
let (_db_dir, registry) = common::temp_registry(&[(thread_id, None, None, Some(&rollout_path))]);
let session = CodexSession::new(options, None, ResolvedPath::from_value("/nonexistent-mf339"));
session.set_scan_deps(CodexScanDeps {
    registry,
    rollout: RolloutReaderDeps { sessions_root: Some(root.path().to_path_buf()) },
});
```

with `options.chat_id = Some(thread_id)` (that is what `CodexSession::new` stores as `resume_thread_id`).
Seed the registry through the existing `mod common;` helper `temp_registry`
(`crates/mainframe-adapter-codex/tests/common/mod.rs:185-204`), which creates the `threads` table with the
four columns `read_metadata` selects (`id, agent_nickname, agent_role, rollout_path`) — hand-rolling the
schema risks a column mismatch that surfaces as a silent fallback, not a failure.
This test owns its own `tempfile::TempDir` and writes its own task-14-shaped rollout into it — separate
test binary, no sharing with task 14 — named `rollout-<anything>-<threadId>.jsonl` so the filename embeds
the thread id, under the injected `sessions_root`.
Case 1: `load_scan_records()` returns a `Vec<ChatMessage>` containing an `Assistant` message with a `Bash`
tool_use carrying the command and a following `ToolResult` message carrying the PR URL.
Case 2: no row for the thread id ⇒ falls back to `load_history` and returns an empty vec without
panicking. The nonexistent `ResolvedPath` is what keeps that offline: `load_history` spawns a real
`codex app-server` via `spawn_temp_app_server` (`session.rs:724-745`) on any machine where `codex`
resolves, and the spawn is given `resolved_path` as its `PATH`. Pin the same nonexistent `ResolvedPath` in
**both** cases, so a happy-path regression can never reach a real `codex` either.
*Verify (tasks 14-15):* `cargo test -p mainframe-adapter-codex --test rollout_unified_exec` — expected to
fail on behavior; `cargo test -p mainframe-adapter-codex --test load_scan_records` — expected to fail to
compile ("cannot find `CodexScanDeps`") until task 17.

### Group E — Codex scan source (core)

**Task 16 — teach the rollout reader the unified exec tool.**
`packages/core-rs/crates/mainframe-adapter-codex/src/rollout_reader.rs`: widen `RolloutPayload.output` to
accept both shapes, e.g.
```rust
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub(crate) enum RolloutOutput { Text(String), Blocks(Vec<RolloutContent>) }
```
with an `as_text()` that returns the string or joins the blocks' `text` fields; update the two existing
`p.output.as_deref()` call sites in `rollout_reconstruct.rs` accordingly.
`packages/core-rs/crates/mainframe-adapter-codex/src/rollout_reconstruct.rs`: add a
`pending_unified_exec: HashMap<String, String>` map threaded through `parse_rollout_lines` /
`apply_rollout_payload` alongside the existing three, plus:
- in `handle_custom_tool_call`: when `name == "exec"`, extract the command from the `input` — find
  `tools.exec_command(`, brace-match the following JSON object, `serde_json::from_str` it, read `cmd` as a
  string or an array of strings (joined with a single space) — and stash it by `call_id`. A parse failure
  logs `tracing::debug!(module = "codex:rollout", …)` and skips the pair.
- in `handle_custom_tool_call_output`: when the `call_id` is a pending unified exec, push
  `ThreadItem::CommandExecution { id: call_id, command, aggregated_output: output.as_text(), exit_code: None, status: "completed" }`.
  `exit_code: None` is deliberate — the unified-exec output carries no exit code, and `is_exec_error(None)`
  is `false`, which the ungated history scan ignores.
Keep the command extraction in its own helper under 50 lines; keep both files under 300 lines (split the
extraction into a new `rollout_unified_exec.rs` if `rollout_reconstruct.rs` would overflow).
*Verify:* `cargo test -p mainframe-adapter-codex --test rollout_unified_exec --test rollout_reader`.

**Task 17 — implement `CodexSession::load_scan_records`, with a test seam.**
First add the seam task 15 constructs, in
`packages/core-rs/crates/mainframe-adapter-codex/src/session.rs`:
```rust
/// Test seam for `load_scan_records`: redirects the Codex state DB and the
/// rollout containment root, neither of which the production entry points
/// (`lookup_agent_metadata`, `read_rollout_items(.., None)`) can override.
#[derive(Debug, Clone, Default)]
pub struct CodexScanDeps {
    pub registry: ThreadRegistryDeps,
    pub rollout: RolloutReaderDeps,
}
```
plus a `scan_deps: Arc<Mutex<Option<CodexScanDeps>>>` field on `CodexSession` (initialized to `None` in
`new`) and `pub fn set_scan_deps(&self, deps: CodexScanDeps)`. Re-export `CodexScanDeps` from `lib.rs`
next to `pub use session::CodexSession;`. `ThreadRegistryDeps` and `RolloutReaderDeps` are already `pub`
and both modules are already `pub mod`, so tests can name all three.
Then, next to `load_history` (line 724): override `load_scan_records` to (a) take `resume_thread_id` or
return `Ok(vec![])`, (b) `lookup_agent_metadata_with(&[thread_id], deps.as_ref().map(|d| &d.registry))` →
`rollout_path` — `lookup_agent_metadata` itself takes no deps, so call the `_with` form, (c)
`read_rollout_items(&path, Some(&thread_id), deps.as_ref().map(|d| &d.rollout))`,
(d) `convert_thread_items(&items, &thread_id, &HashMap::new(), &HashMap::new())`. If there is no registry
row, no `rollout_path`, or the read yields no items, log
`tracing::debug!(module = "codex:session", thread_id, "no rollout for PR scan; falling back to thread/read")`
and delegate to `self.load_history()`. No app-server spawn on the happy path.
Keep the body under 50 lines (extract a `rollout_scan_records` helper if needed).
*Verify:* `cargo test -p mainframe-adapter-codex --test load_scan_records` — Group D goes green.

**Task 18 — point the cold-load rescan at the scan source.**
`packages/core-rs/crates/mainframe-server/src/chat_deps.rs:546`: call `session.load_scan_records()` instead
of `session.load_history()` inside `scan_loaded_history`, and replace the discarding
`let Ok(history) = … else { return }` with a match that logs the error before returning (no silent catch).
Leave `session_for_scan` and `persist_plan_and_skill_files` exactly as they are (decision D5); update the
`session_for_scan` doc comment, which currently claims the second load costs "a second temp app-server
spawn (Codex)" — with the override it no longer does.
*Verify:* `cargo test -p mainframe-server --lib scan_loaded_history_tests`; `cargo check --workspace --manifest-path packages/core-rs/Cargo.toml`.

### Group F — end-to-end verification, changeset, docs (test)

**Task 19 — daemon-level persistence + emission test.**
In `chat_deps.rs`'s `scan_loaded_history_tests` module, using the existing in-memory `test_deps()` harness
(`chat_deps.rs:1401`): build a Codex-shaped history (Assistant `Bash` tool_use `gh pr create …` + a
`ToolResult` carrying the PR URL), create a chat row, call `scan_and_persist_prs`, then assert the chat's
`detected_prs` holds one `created` PR and that a `DaemonEvent::ChatPrDetected` was broadcast (subscribe to
the `broadcast::Sender` before the call). Add a second case: run the same scan twice and assert no
duplicate row and no second event; a third: persist `mentioned` first, then `created` for the same URL,
and assert the stored row upgrades in place (acceptance criterion 2).
*Verify:* `cargo test -p mainframe-server --lib scan_loaded_history_tests`.

**Task 20 — layering + purity check.**
Confirm and record in the PR body:
`grep -rn "pr_detection" packages/core-rs/crates | grep -v mainframe-adapter-api` returns only import
lines in `mainframe-chat` and `mainframe-server` (no adapter crate); `grep -rn "Command::new\|reqwest\|process::" packages/core-rs/crates/mainframe-adapter-api/src/pr_detection` returns nothing.
Run the full workspace gate: `cargo test --workspace --manifest-path packages/core-rs/Cargo.toml`,
`cargo clippy --workspace --manifest-path packages/core-rs/Cargo.toml -- -D warnings`, `cargo fmt --check`.

**Task 21 — manual QA on the real repro.**
With the built daemon: open Codex chat `kEIpCdjD3FR2SK7e9x-D8` (thread
`019ff4ce-845c-7492-8cef-8efb04ac6885`, `detected_prs = []` today) and confirm
`sqlite3 -readonly ~/.mainframe/mainframe.db "SELECT detected_prs FROM chats WHERE id='kEIpCdjD3FR2SK7e9x-D8'"`
then holds `https://github.com/qlan-ro/mainframe/pull/614` with `source: created`. Live check (now that
#332 has merged): run `gh pr create` in a Codex session and confirm the PR row appears without a reopen.
Do not run the daemon against the production data dir — follow the memory note and set
`MAINFRAME_DATA_DIR` + `DAEMON_PORT`, copying the DB if the QA needs the real chat row.

**Task 22 — changeset and docs.**
`.changeset/codex-pr-detection.md` with `'@qlan-ro/mainframe-ui': patch` and a short user-facing note:
pull requests opened from a Codex session are now detected, live and on reload, because detection moved off
the Claude adapter onto the shared message stream. Add a row to
`docs/adapters/codex/CONSUMED-SURFACE.md` for the rollout unified-exec pair (`custom_tool_call name:"exec"`
+ array-shaped `custom_tool_call_output`) naming `rollout_reconstruct.rs` and the new test as its receipt,
and note there that `thread/read` returns no `commandExecution` items.
*Verify:* `git status` shows the changeset; the pre-push hook accepts the branch.

---

## Out of scope

- #332's client subscriber (merged) and any further client work.
- Any PR UI surface change.
- Redesigning the detection heuristics (which commands count, which tools are scanned).
- Branch→PR association, GitHub API polling, PR review/CI state.
- Changing what a reloaded Codex chat *displays* (see the follow-up below).
- A backfill sweep over existing Codex chats.

## Follow-ups discovered while planning (do not fix here)

1. **Codex chat reload silently drops all command executions and reasoning from the transcript.** Same
   `thread/read` behavior, user-visible, independent of PR detection: reopening a Codex chat shows agent
   messages and file changes but no bash cards and no thinking. Worth its own todo; the rollout reader this
   plan extends is most of the machinery a fix would need.
2. **Mainframe still sends `persistExtendedHistory` / `persistFullHistory` on `thread/start` and
   `thread/resume`,** but codex-cli 0.147.0's `ThreadStartParams` has neither field. Dead parameters.
3. **`scan_loaded_history` builds a second `AdapterSession` per chat activation** and, for Codex, that
   session is pushed into the adapter's `sessions` vec and only removed on exit — a slow leak. Threading
   the already-loaded session into the seam (the `TODO(port)` at `lifecycle_manager.rs:911`) would remove
   both the duplicate load and the leak.

## Risks

- **`is_error` edge.** Path B currently reads the raw JSON `is_error` with `as_bool() == Some(true)`; the
  canonical block carries `js_truthy(is_error)`. The CLI only ever emits booleans, so no existing case
  differs — recorded as a known non-difference rather than a silent change.
- **Ordering assumption.** The decorator assumes the tool_use block reaches `on_message` before its
  tool_result reaches `on_tool_result`. True for Claude (assistant event precedes the user event) and Codex
  (`render_command_execution` calls them back to back); a future adapter that violates it degrades to
  `mentioned`, never to a wrong PR.
- **Group B is compile-red until Group C, and task 15 is compile-red until task 17.** Both name a type the
  implementation task introduces (`PrDetectionSink`, `CodexScanDeps`). Expected; do not soften the specs to
  make them build. Task 14 is the one red-phase spec that compiles and fails on behavior.
- **Unified-exec command extraction is string surgery over a JS snippet.** It is defensive (parse failure
  skips the pair, logged at debug) and covered by a malformed-input test, but a future Codex change to the
  exec wrapper would silently stop reconstruction — the CONSUMED-SURFACE row added in task 22 is the
  tripwire.
