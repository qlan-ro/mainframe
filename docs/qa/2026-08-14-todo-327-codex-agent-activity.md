# todo #327 — QA: Codex sub-agents as session activity

Live smoke test of `todo/327-codex-agent-activity` at `d2a2fb73`, against the
plan's scope (`docs/plans/2026-08-14-todo-327-codex-agent-activity-plan.md`).

**Result: PASS — 4/4 scenarios.** A Codex-shaped delegated sub-agent opens one
running `agent` row in the Activity panel with the correct glyph, the rail
dot and "1 task running" label; the elapsed column ticks past the 60s
boundary while it runs; resolving the delegation ends the row, clears the
rail dot, and reverts the label to "Activity"; and an ordinary non-subagent
tool (`Bash`) opens no row at all.

## Scope

Todo #327 is a Rust adapter change (`mainframe-adapter-codex`,
`mainframe-adapter-mock`) with no renderer diff — the Activity panel already
reads one adapter-agnostic model (plan fact 16). Two live-app surfaces exist:

1. **Codex → tracker.** `collab_activity.rs` writes to `BackgroundTaskTracker`
   from real Codex protocol events. No deterministic live trigger exists for
   this — a genuine Codex delegation is a live-LLM turn, which the test
   process replaces with a fixture rather than drive. This half is covered by
   the branch's own cargo integration tests (`tests/collab_activity.rs`, 20
   cases) — CI territory, not re-run here.
2. **tracker → panel**, exercised end to end through the *mock* adapter's new
   replay-derived bridge (`mainframe-adapter-mock/src/task_bridge.rs`), which
   is exactly plan task 10's e2e vehicle. This is what this probe drives live.

## Environment

- Target: `browser` (renderer + Rust daemon only — no native-shell surface in
  this diff).
- Daemon: `packages/core-rs/target/debug/mainframe-daemon`,
  `DAEMON_PORT=31980`, `MAINFRAME_DATA_DIR=~/.mainframe_dev`, launched via
  `.agents/test-env.sh up browser` with `E2E_MODE=mock`,
  `E2E_RECORDINGS_DIR=<worktree>/packages/e2e/fixtures/recordings`,
  `E2E_RECORDING_KEY=<task-subagent|bash-exit-code>`.
- UI: `packages/ui` Vite dev server, `VITE_PORT=5732`.
- Driver: Playwright (`chromium.launch()`, headless), viewport 2000×1000 —
  wide enough to force the session panel's `inline` layout (see the S3
  false-alarm note below). Scratch scripts ran from `/tmp` and the worktree
  root and were deleted before this commit; not part of the diff.
- Project under test: a throwaway git repo under `~/tmp/mf-qa327-*`,
  registered via `POST /api/projects`. Chats created per scenario via
  `POST /api/chats {adapterId:"mock-cli", ...}` — the mock adapter's replay
  index increments once per daemon lifetime per recording key, so each new
  fixture read needed a fresh `test-env.sh down && up` cycle (index 0 is the
  only file present for either fixture).

## Scenarios

| # | Scenario | Class | Mode | Status | Evidence |
|---|---|---|---|---|---|
| S1 | Turn 1 delegates to a sub-agent → exactly one running `agent` row, correct glyph, rail dot + "1 task running" | happy | ui | PASS | `{"rowVisible":true,"kindGlyph":true,"rowText":"Find the greeting exportAgent<1m","railDot":true,"railLabel":"1 task running"}` |
| S2 | Elapsed column ticks past the 60s "<1m"→"1m" boundary while the row is live | happy | ui | PASS | 10s-interval poll: `<1m` through t=50s, `1m` from t=60s through t=80s |
| S3 | Turn 2 resolves the delegation → row ends, rail dot clears, panel shows "Nothing running", label reverts to "Activity" | happy | ui | PASS | `{"rowCountAfter":0,"cardStillVisible":true,"emptyVisible":true,"dotGone":true,"railLabelAfter":"Activity"}` — row detached within 500ms of the resolving send |
| S4 | An ordinary `Bash`-only recording (no subagent tool) → no agent row opens | regression | ui | PASS | `{"emptyVisible":true,"anyAgentRow":0,"railLabel":"Activity","dotCount":0}` |

No surface defects.

## A false alarm worth recording

The first S3 pass, run at 1600×1000, showed the row correctly ending
(`rowCountAfter:0`, `dotGone:true`) but the panel itself unmounted
(`cardDomCount:0`) instead of showing the "Nothing running" empty state —
looking, at a glance, like the panel was closing itself when work ended.
Step-by-step tracing (`aria-pressed` + DOM count before/after each action)
showed the close happened **synchronously on the composer's send click**, well
before any tracker event could fire. Cause: at 1600px the sidebar leaves the
chat surface's gutter under `INLINE_MIN_WIDTH` (1468px,
`panel-mode.ts`), so the Activity panel opens as a floating `overlay`, not
`inline` — and `use-session-panel-state.ts`'s light-dismiss listener treats
any pointerdown outside the floating card, including the send button, as a
request to close it. That is pre-existing, working-as-designed behavior
("a light-dismiss companion, not a modal") from before this branch, unrelated
to #327. Re-run at 2000px (comfortably past the inline threshold) reproduced
the clean result in the table above. Filed here only so the next probe
doesn't re-spend time on it — not a #327 regression, and not a new finding
against the light-dismiss design itself.

## Out of scope for this probe

- The Codex adapter's own protocol→tracker mapping (no live trigger; CI's
  `collab_activity.rs` integration tests own it — see Scope above).
- Native Tauri shell (`tauri`/`tauri-qa` targets) — this diff has no
  native-only surface; `browser` is the cheapest sufficient target per
  `.agents/test-worktree.md`.
- Stop/cancel affordance for a Codex agent row — explicitly out of scope for
  #327 (owned by #328); Codex continues to answer `stop_background_task` as
  unsupported, unchanged by this branch.

## Teardown

`.agents/test-env.sh down` — ports `31980`, `5732`, `9222` confirmed clear.
No daemon or Vite process left running from this probe.
