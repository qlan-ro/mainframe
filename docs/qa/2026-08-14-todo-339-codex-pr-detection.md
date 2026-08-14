# todo #339 — QA: Codex PR detection

Live probe of `todo/339-codex-pr-detection` at `1ea9c326`, the fix that lifts
PR detection out of the Claude adapter into an adapter-neutral layer
(`mainframe-adapter-api::pr_detection`) so Codex sessions detect PRs too,
live and on cold-load reload.

**Result: PASS, 3/3 core scenarios.** Both the cold-load rescan (on a real
external Codex session with a genuine `gh pr create` in its rollout) and the
live decorator path (proven adapter-neutral via the mock adapter) correctly
detect, classify, and persist the PR, and broadcast `chat.prDetected`. One
defect found, scoped below as pre-existing and not blocking this branch's
acceptance criteria.

## Environment

- Target: `browser` (renderer + Rust daemon from source; no native-shell
  surface is in scope for this fix). `DAEMON_PORT=32370`, `VITE_PORT=5857`,
  `MAINFRAME_DATA_DIR=~/.mainframe_dev`. Launched via
  `.agents/test-env.sh up browser --worktree <this worktree>`.
- Driver: `playwright-cli`, headed, against `http://localhost:5857`.
- S1 project: pre-existing `mainframe` project pointed at the primary
  checkout (`/Users/doruchiulan/Projects/qlan/mainframe`) — chosen because
  its registered external Codex sessions include a real transcript with a
  genuine `gh pr create` and PR URL (see below).
- S2/S3: `E2E_MODE=mock`, `E2E_RECORDINGS_DIR=/tmp/mf-qa339-fixtures`
  (scaffolding, not committed), adapter id `mock-cli` (the mock adapter's
  actual registered id — `mock` silently creates a chat with no matching
  adapter and never runs).
- Teardown: `.agents/test-env.sh down` → `STOP_OK: ports 32370 5857 9222
  clear`. Production daemon (`:31415`) and `/Applications/Mainframe.app`
  verified healthy throughout and after.

## Scenarios

| # | Scenario | Class | Mode | Status | Evidence |
|---|----------|-------|------|--------|----------|
| S1 | Cold-load rescan on a **real** Codex rollout containing `gh pr create` + its PR URL | happy | db+api+ui | PASS | `assets/2026-08-14-todo-339/s1-cold-load-pr-detected.png`; DB row has `detected_prs` with `source:"created"`; `GET /api/chats?projectId=` shows it; UI Summary PR badge (`PR #479`) renders in the open session |
| S2 | Live detection through the shared decorator (mock adapter standing in for "any adapter") — Bash `gh pr create` tool_use + tool_result carrying the PR URL | happy | api+db | PASS | `assets/2026-08-14-todo-339/s2-live-mock-pr.png`; DB row `detected_prs` has `source:"created"`, `url` matches the fixture's PR #9001; `chat.prDetected` path confirmed via `onResult`/`chat.updated` log lines |
| S3 | Codex transcript still renders correctly (regression — `rollout_reconstruct.rs`/`rollout_unified_exec.rs` changed materially) | regression | ui | PASS | Same S1 screenshot: a 170-message real transcript (87 exec calls, patches, sub-agent cards) renders with no visual corruption or console errors beyond two pre-existing warnings |

S4 (a `mentioned`-without-create classification case) was cut for time —
`created`-path classification is already proven live twice (S1 cold-load,
S2 live), and `mentioned`/dedupe/upgrade semantics are unit-tested on this
branch (`pr_detection_history.rs`, `pr_detection_sink.rs`). Not run; noted
per the skill's honesty requirement rather than silently dropped.

## S1 in detail — why a live probe, not just the unit tests

The branch's own tests exercise `read_rollout_items` → `convert_thread_items`
→ `scan_history_for_prs` against synthetic fixtures, and the registry lookup
against an injectable temp DB. Neither proves the real, on-disk
`~/.codex/state_5.sqlite` registry plus a real multi-hundred-line rollout
file — written by an actual `codex-cli 0.144.3` session — round-trips through
the daemon's live wiring.

The probe used thread `019f6d1c-7a74-7200-beef-76ba9d3b0fcb`
(`~/.codex/sessions/2026/07/17/rollout-2026-07-17T01-46-50-...jsonl`, 506
lines), a genuine session that ran `gh pr create --base main --head
fix/codex-context-indicator ...` via the modern "unified exec" tool and got
back `https://github.com/qlan-ro/mainframe/pull/479` — real PR #479 in this
repo. Registry lookup confirmed via `~/.codex/state_5.sqlite`'s `threads`
table before driving the app (read-only query, never mutated). Steps:
imported the external session (`POST
/api/projects/:id/external-sessions/import`), opened it in the UI to trigger
`do_load_chat` → `scan_loaded_history` → `load_scan_records`, then checked
DB + both chat-read API surfaces.

To isolate a mid-run discrepancy (see Defect below), the pipeline was also
driven directly and offline against the real rollout file, bypassing the
daemon entirely — `read_rollout_items` → `convert_thread_items` →
`scan_history_for_prs` on the actual 506-line file — confirming the parsing,
reconstruction, and classification logic is correct in isolation
(`source: Created`, exact URL, on the first try). This was a temporary
`#[cfg(test)]` scratch module added to `rollout_unified_exec.rs` and reverted
before continuing (never committed; `git status` confirmed clean afterward).

## Defect: `GET /api/chats/:id` serves a stale `detectedPrs` for an active chat

**Not a regression from this branch — pre-existing, and does not block
#339's acceptance criteria.**

`ChatManager::get_chat` (`mainframe-chat/src/chat_manager/reads.rs`) returns
the in-memory `ActiveChat.chat` clone whenever a chat is "active" in the
daemon's cache, falling back to a fresh DB read only when it isn't. Neither
the cold-load rescan (`chat_deps.rs::scan_and_persist_prs`) nor the live sink
(`event_handler.rs::on_pr_detected`) updates that in-memory clone after
writing `detected_prs` to the DB — both only DB-write and WS-broadcast. So
`GET /api/chats/:id` for an active chat can return `detectedPrs: []` even
though the DB row and `GET /api/chats?projectId=` (which reads fresh from
DB, no cache) both show the PR correctly.

Reproduced twice, independently: once via S1's cold-load rescan, once via
S2's live turn — same symptom both times, ruling out a Codex-specific cause.
The DB write, the list endpoint, and the actually-rendered UI (Summary PR
badge, sidebar glyph) are all correct in both cases, which is what #339's
acceptance criteria and #332's UI wiring depend on. `mentions` (an older,
unrelated field written the same way by `scan_and_persist_mentions`) shares
the identical write pattern, which is why this reads as a pre-existing
gap in the active-chat cache rather than something introduced here — filing
as a defect for the fix owner to triage rather than expanding this branch's
scope.

## Notes

- Both `L8wxBfFdHk3_SN3YKX5aX` (mock-cli, live path) and the imported Codex
  chat `HAkjeC0yezHt7YCoAT4KL` were deleted from `~/.mainframe_dev/mainframe.db`
  after the run. The fixtures directory (`/tmp/mf-qa339-fixtures`) was
  scaffolding under `/tmp`, removed after the run.
- `~/.codex/sessions` and `~/.codex/state_5.sqlite` were read-only inputs,
  never mutated.
- The shared dev data dir (`~/.mainframe_dev`) carries many chats from prior
  QA runs (unrelated projects/branches); this probe touched only the chats
  it created plus one read-only `GET` against the pre-existing `mainframe`
  project's external-sessions list.
