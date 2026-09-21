# changelog-watch: codex rust-v0.145.0 → rust-v0.150.1 (2026-08-27)

Releases covered: 0.146.0, 0.146.1, 0.147.0, 0.148.0, 0.149.0, 0.149.1, 0.150.0, 0.150.1.

Entries seen: 75 · risks: 11 · opportunities: 1 · relevant, no action: 18 · dropped as irrelevant: 49

**Counting convention.** Codex releases carry two layers: curated summary bullets
(New Features / Bug Fixes / Documentation / Chores) and a per-PR changelog running to
hundreds of lines. The 75 entries counted above are the curated bullets — the unit a
second run can reproduce. Seven risks map to a curated bullet; four more were found only
in the per-PR list and are reported separately below, which is why the risk total is 11
against a 75-bullet accounting of 7 + 1 + 18 + 49. 0.149.1 shipped with no notes.

Two themes dominate: **rollout storage is being migrated** and **thread history is now
paginated**. Both sit under rows Mainframe depends on for history and resume.

## Compatibility risks

### high — Organize conversations into persistent sections and browse long transcripts incrementally (0.147.0, #35722/#36007/#36380/#36948/#36950); Fork threads with paginated history (0.146.0, #35220/#35251)

- Checklist row: `CODEX-RPC-04` — `src/session.rs` (thread/read call sites), `src/thread_registry.rs::lookup_agent_metadata`
- Why it threatens the row: Mainframe calls `thread/read` with `includeTurns: true` and
  treats the response as the complete history. Upstream has spent three releases making
  history paginated — the curated bullets above plus `#38244 Resolve paginated thread
  history by rollout ID` and `#38292 Add durable reverts for paginated threads`. If
  `includeTurns: true` now returns a page rather than everything, resumed Codex history
  comes back silently truncated: the response deserializes fine, it just stops early.
  That is the row's stated symptom ("resumed history comes back empty") in its partial
  form, which is harder to notice than empty.
- Recommended regression test: add `#[test] thread_read_collects_every_page_of_history`
  in `tests/history.rs` alongside
  `extracts_text_from_content0_text_the_thread_read_shape`, building a two-page
  `thread/read` response inline and asserting turns from both pages appear — not just
  that the first page parsed.
- Verify live: .claude/skills/codex-protocol-debugger/

### high — Resumed and forked threads now restore their active permission profile instead of silently falling back to current defaults (0.149.0, #39153); Resumed sessions now restore their persisted working directory and approval policy (0.148.0, #37198/#37368/#38605)

- Checklist row: `CODEX-RPC-02` — `src/session.rs` (the `thread/start`/`thread/resume` param block, `ensure_thread`); also `CODEX-RPC-03` (`src/turn_config.rs::build_turn_config`)
- Why it threatens the row: Mainframe sends `approvalPolicy`, `sandbox`, and `cwd` on
  every `thread/resume`. Upstream now restores the thread's *persisted* profile and cwd
  instead of applying current defaults. If the persisted values win over what Mainframe
  sends, a resumed thread runs under a different approval policy and possibly a
  different working directory than the UI shows — a silent permissions divergence, not
  an error. Reinforced by `#39145 Persist active permission profiles in turn context`
  and `#39147 Centralize persisted resume settings lookup`.
- Recommended regression test: add `#[test]
  a_resumed_thread_honors_the_approval_policy_we_send` in `tests/` (the crate builds
  payloads inline; no fixture dir), pinning a `thread/resume` whose persisted profile
  differs from the sent one and asserting the effective policy is Mainframe's.
- Verify live: .claude/skills/codex-protocol-debugger/

### high — Rollout migration tooling and background migration (per-PR only: #37348, #37191, #38127, #39273, #39784, #40499)

- Checklist row: `CODEX-FILE-01` — `src/external_sessions.rs::{codex_sessions_root, list_external_sessions}`, `src/external_session_parse.rs::{parse_lines, extract_meta}`, `src/rollout_reader.rs`
- Why it threatens the row: the row pins a precise on-disk contract —
  `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<threadId>.jsonl`, a `session_meta`
  head record, a `{type, payload}` envelope. Six PRs across this range implement a
  *background* rollout migration, and one of them, `#38127 Distinguish rollout IDs from
  thread IDs`, directly undercuts the filename convention, which embeds the thread id.
  A migration that runs on startup and rewrites paths or line format means Mainframe's
  external-session list and sub-agent history reload go quietly empty or partial. No
  curated bullet announces this, which is exactly why it is worth surfacing.
- Recommended regression test: add `#[test]
  list_external_sessions_reads_post_migration_rollout_files` in
  `tests/external_sessions.rs`, pinning a migrated filename and `session_meta` head
  record captured from a 0.150 `~/.codex/sessions` tree; assert the extracted metadata
  values, not just that parsing returned `Ok`.
- Verify live: .claude/skills/codex-protocol-debugger/

### high — Retire the untrusted approval policy (per-PR only: #39630); Reject obsolete app-server permission profile fields (#38919); Reject lossy legacy permission projections (#39117)

- Checklist row: `CODEX-RPC-02` / `CODEX-RPC-03` — `src/session.rs` param blocks, `src/turn_config.rs::build_turn_config`
- Why it threatens the row: `approvalPolicy` is a required param on both `thread/start`
  and `turn/start`. Upstream retired one policy value and now *rejects* obsolete
  permission-profile fields rather than ignoring them. `CODEX-RPC-03` already documents
  that a malformed turn/start returns `-32600` and no turn starts — a loud failure, but
  a total one. Confirm which `approvalPolicy` string Mainframe sends and whether it
  survived the retirement; this is a fast check with a decisive answer.
- Recommended regression test: add `#[test]
  the_approval_policy_we_send_is_in_the_current_vocabulary` in `src/turn_config.rs`
  tests, next to
  `service_tier_fast_when_tuning_fast_true_and_undefined_when_false`, pinning the exact
  string sent for each mode.
- Verify live: .claude/skills/codex-protocol-debugger/

### medium — Fork sessions with `codex exec fork`, and archive or restore sessions from the TUI resume picker (0.148.0, #37367/#37369/#37371)

- Checklist row: `CODEX-FILE-01` — `src/external_sessions.rs::list_external_sessions`
- Why it threatens the row: archiving relocates rollout files —
  `#39256 Deduplicate rollout moves when archiving threads` and `#40179 Shut down
  resumed descendants when archiving thread trees` confirm files move, not just a flag
  flips. Mainframe discovers external sessions by scanning the sessions tree, so
  archived threads either vanish from the picker without explanation or reappear from a
  new location as duplicates.
- Recommended regression test: add `#[test]
  archived_threads_are_classified_not_silently_dropped` in
  `tests/external_sessions.rs`, pinning the on-disk location an archived rollout lands
  in and asserting the expected list membership.
- Verify live: .claude/skills/codex-protocol-debugger/

### medium — Fixed duplicate sub-agent activity and tightened TUI routing for sub-agent notifications and approvals (0.149.0, #39049/#39088)

- Checklist row: `CODEX-ITEM-02` — `src/collab_protocol.rs::classify_sub_agent_kind`, `src/collab_activity.rs::open_activity`; also `CODEX-ITEM-03` (`end_activity`)
- Why it threatens the row: both rows are Verified only at 0.144.3, and this range
  reworks exactly their lifecycle. Beyond the curated bullet, 0.150.0 adds `#40437
  Report completed sub-agent activity on parent turns` and `#40449 Route peer agent
  completion activity to the initiating turn` — completion activity now arrives on a
  different turn than before. `CODEX-ITEM-03`'s symptom applies directly: rows never end
  and the Activity panel keeps a stuck running count, or a re-engaged sub-agent gets no
  row.
- Recommended regression test: extend
  `tests/collab_activity.rs::close_agent_ends_the_entry` with a completion routed to the
  parent/initiating turn rather than the sub-agent's own, asserting the running-entry
  count returns to zero.
- Verify live: .claude/skills/codex-protocol-debugger/

### medium — Require explicit trust for unfamiliar local projects (0.147.0, #36960/#37132)

- Checklist row: `CODEX-RPC-02` — `src/session.rs` (`thread/start` params, `ensure_thread`)
- Why it threatens the row: Mainframe runs Codex sessions inside git worktrees it
  creates. 0.149.0 adds `#39616 Validate linked worktrees before inheriting project
  trust`, so a fresh worktree may no longer inherit the parent repo's trust. Combined
  with the explicit-trust requirement here, `thread/start` in a new worktree can fail or
  stall on a trust gate Mainframe has no path to answer — the row's symptom, "new
  sessions fail to start".
- Recommended regression test: add `#[test]
  a_fresh_worktree_cwd_starts_a_thread_without_a_trust_gate` in `tests/`, pinning the
  `thread/start` params for a worktree path and asserting a successful start rather than
  an error response.
- Verify live: .claude/skills/codex-protocol-debugger/

### medium — Standardize shell execution on unified exec (per-PR only: #39757, #39772)

- Checklist row: `CODEX-FILE-04` — `src/rollout_reconstruct.rs::{handle_custom_tool_call, handle_custom_tool_call_output}`, `src/rollout_reader.rs::RolloutOutput`
- Why it threatens the row: this row is the only path that recovers Codex command output
  for offline scanning (PR detection, todo #339), and it is Verified at 0.147.0 — inside
  this range but before the churn. "Standardize shell execution on unified exec" routes
  *more* commands through the wrapper the row parses, and seven further PRs rework its
  output framing (`#39937 Bound unified exec output delta frames`, `#39957 Add in-memory
  shell snapshots to unified exec`, `#39259 Simplify unified exec output snapshots`,
  `#39515`, `#39712`, `#40024`, `#39311`). The row's symptom is that cold-load PR
  scanning goes quietly empty again.
- Recommended regression test: extend
  `tests/rollout_unified_exec.rs::unified_exec_reconstructs_command_execution_with_the_pr_url`
  with an exec pair captured from a 0.150 rollout, asserting the reconstructed command
  string and the extracted PR URL.
- Verify live: .claude/skills/codex-protocol-debugger/

### medium — Raise the GPT-5.6 maximum context window (per-PR only: #39102)

- Checklist row: `CODEX-EVT-04` — `src/turn_lifecycle.rs::handle_token_usage`; window source in `CODEX-PROBE-02` (`src/adapter.rs::map_codex_model`)
- Why it threatens the row: the context gauge divides `state.last_usage` by the model's
  context window. If Mainframe's window for GPT-5.6 comes from anywhere other than the
  live `model/list` response, the percentage is now computed against a stale
  denominator and reads high for every Codex session on that model. Nothing errors —
  the gauge is simply wrong, which is the quiet failure mode this row already warns
  about.
- Recommended regression test: add `#[test] the_gpt_5_6_context_window_tracks_model_list`
  in `tests/list_models.rs`, pinning the window from a captured 0.150 `model/list`
  response and asserting the mapped value matches.
- Verify live: .claude/skills/codex-protocol-debugger/

## Adoption opportunities

- **`max` and `ultra` reasoning efforts** (0.149.0, #38817/#39662) — two new effort
  levels reachable through the SDK. `CODEX-PROBE-02` reads `supportedReasoningEfforts`
  from `model/list`, so the catalog side is additive and safe, but `CODEX-FLAG-03`
  (`packages/ui/.../CodexTuningDefaults.tsx`) hardcodes its vocabulary independently of
  the Rust crate — that mirror is where the new levels go missing. The row's stated
  symptom is exactly this: "Settings UI … is missing a newly added one." Size: small.

## Relevant, no action

**0.150.1**

- Remote compaction now counts retained images toward its token budget, trimming older images as needed — `CODEX-EVT-04`/`CODEX-EVT-01`: changes what compaction retains, not the `thread/tokenUsage/updated` or `thread/compacted` shapes.

**0.150.0**

- Unnamed terminal tasks receive descriptive titles automatically, and `/rename` suggests an editable title — `CODEX-FLAG-04`: Mainframe generates its own titles through the ephemeral `exec` one-shot and never reads Codex's.
- New `Interrupt` hooks can run commands or MCP handlers when an active top-level turn is interrupted — `CODEX-RPC-03`: additive around `turn/interrupt`; the request shape is unchanged.
- Untrusted projects no longer supply project-level `AGENTS.md` instructions — `CODEX-FLAG-04`: the title one-shot already runs from a temp cwd specifically to keep `AGENTS.md` out of the prompt.
- Improved credential redaction in app-server diagnostics — app-server logging only; no notification or result shape changes.
- Prevented Unix shutdown hangs caused by detached processes retaining a terminal or full terminal output buffers — `CODEX-EVT-05`: Mainframe pipes the app-server's stdout and stderr, so a child blocking on a full output buffer is a failure mode it is directly exposed to. A fix, and one worth knowing about.

**0.149.0**

- Added `/cd`, `/pwd`, and `/cwd` commands for managing the working directory in TUI sessions — `CODEX-FILE-01`: a mid-session cwd change would move where rollouts land, but these are TUI commands Mainframe's app-server sessions never issue.
- Queued messages now wake idle sessions reliably and preserve pasted or deferred command semantics — `CODEX-RPC-03`: Mainframe submits turns through `turn/start`, not the CLI queue.

**0.148.0**

- View estimated thread credits or cost in `/status`, status lines, and terminal titles — `CODEX-RPC-05`: a TUI surface over data the quota puller already reads through `account/rateLimits/read`.
- Use Amazon Bedrock Runtime as a built-in provider with GPT-5.6 routing — `CODEX-PROBE-02`: new catalog entries arrive through `model/list` and map by the existing fields.
- Model switches and settings updates no longer leave stale instructions behind or change an active turn midstream — `CODEX-RPC-03`: Mainframe resolves a concrete model before every turn, so it never relied on mid-turn switching.
- Turns reconnect through temporary provider outages, and MCP servers recover after OAuth reauthentication without restarting Codex — `CODEX-EVT-01`: fewer dropped turns, same notification shapes.

**0.147.0**

- Import Cursor-managed skills and synchronize changes to imported Claude and Cursor conversations without creating duplicates — `CODEX-FILE-01`: worth knowing that foreign conversations can now land in Codex's store; the rollout parse path is unchanged and the dedup is upstream's.
- Redact secrets and complete bearer tokens from displayed commands and replayed conversation history — `CODEX-FILE-04`: alters command text in replayed history, but redaction targets credentials, not the PR URLs the reconstruction scans for.
- Remove the deprecated `codex exec --full-auto` flag; use `--sandbox workspace-write` instead — `CODEX-FLAG-04`: the title one-shot passes `--ephemeral --ignore-user-config --skip-git-repo-check -C -s read-only --color never`, none of which is `--full-auto`. Recorded because the row's failure mode is precisely an `exec` flag being removed: rc=2 and every title falls back to a truncated first message.

**0.146.0**

- Name new sessions with `/new` or `/clear`, pin important threads, and switch between side conversations — `CODEX-FILE-01`: thread naming and pinning are metadata Mainframe does not read.
- Preserve submitted messages, final responses, failed-turn errors, imported timestamps, and approval settings across interruptions, replay, imports, and forks — `CODEX-EVT-01`/`CODEX-ITEM-01`: a durability fix on items Mainframe already maps.
- Publish release artifacts, channel metadata, and installer aliases through OpenAI-hosted release infrastructure, with GitHub fallback — **not an adapter risk, a watcher risk.** This skill's Codex source is GitHub releases (`mode: "releases"` in `state.json`). If upstream demotes GitHub to a fallback, the fetcher can start returning stale or empty deltas — and per the skill's own failure-mode note, an empty delta is only trustworthy when the CLI says `no changes`. Worth re-checking at the next run.

## Dropped as irrelevant (49)

Per-release: 0.150.0 (7), 0.149.0 (9), 0.148.0 (7), 0.147.0 (12), 0.146.1 (1),
0.146.0 (13). The categories: TUI dashboards, composer, Vim mode and rendering;
`codex doctor` diagnostics; Agent Plugins, marketplaces and plugin isolation; MCP
transport, OAuth and protocol-version work; sandbox hardening on Linux, macOS Seatbelt
and Windows; Amazon Bedrock provider plumbing; Realtime/WebRTC; proxy configuration;
release packaging, notarization and dependency bumps; and contributor documentation.
