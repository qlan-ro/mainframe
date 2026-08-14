# todo #332 — QA: live-thread PR detection

Live probe of `todo/332-live-thread-pr-detection` at `cb8f1204`, the fix that
routes `chat.prDetected` to the sessions-list reload
(`packages/ui/src/features/sessions/ws/session-list-router.ts`).

**Result: PASS, 4/4.** A PR detected mid-turn in the session the user has open
appears in that session's Summary PR row, session-row glyph, and the "has PR"
filter, with no reopen and no reload. A duplicate detection adds nothing. A
backgrounded session's PR survives being backgrounded and still renders on
reopen (no regression).

## Why a live probe, not just the unit tests

The branch's own tests (`session-list-router.test.ts`,
`use-session-list-router.test.tsx`) exercise the router class in isolation
with a mocked `onReload` — they prove the switch-case and the debounce, not
that the reload actually repaints the three PR surfaces. That gap is a live
running-app surface CI doesn't see, so this probe drives the real chain:
daemon detects → persists → broadcasts → client router → debounced reload →
thread-list projection → Summary row / session-row glyph / has-PR filter.

## Environment

- Target: `browser` (renderer + Rust daemon from source; no native-shell
  surface is in scope for this fix). `DAEMON_PORT=31748`, `VITE_PORT=5500`,
  `MAINFRAME_DATA_DIR=~/.mainframe_dev`. Launched via
  `.agents/test-env.sh up browser --worktree <this worktree>` with
  `E2E_MODE=mock` exported first.
- Driver: Playwright (`playwright-skill`), headed, 1600×1000, against
  `http://localhost:5500`.
- Project under test: pre-existing `qa327` project
  (`/Users/doruchiulan/tmp/mf-qa327-rlzX`).
- **Deterministic trigger, not a live LLM turn.** The daemon's native replay
  adapter (`mainframe-adapter-mock`, gated behind `E2E_MODE=mock`) dispatches a
  recorded `onPrDetected` sink event straight into the same `on_pr_detected`
  callback a real Claude turn would call
  (`mainframe-chat/src/event_handler.rs`), so the probe exercises the daemon's
  real persist-then-broadcast path with a scripted, reproducible payload
  instead of waiting on a real `gh pr create`. Fixture shape:
  `E2E_RECORDINGS_DIR=/tmp/mf-qa-332-fixtures`, `E2E_RECORDING_KEY=qa332`,
  files named `qa332.<index>.ndjson` (index auto-increments per new mock-cli
  session in that daemon process — see `example-fixture-s1.ndjson` /
  `example-fixture-s3-dedupe.ndjson` in this folder for the two shapes used).
  These fixtures are scaffolding for this probe, not shipped test assets.
- Teardown: `.agents/test-env.sh down --worktree <this worktree>` →
  `STOP_OK: ports 31748 5500 9222 clear`. Production daemon (`:31415`)
  verified healthy throughout and after (`GET /api/projects` → 200).

## Scenarios

| # | Scenario | Class | Mode | Status | Evidence |
|---|----------|-------|------|--------|----------|
| S1 | PR detected mid-turn in the open session → Summary PR row appears, no reload | happy | ui | PASS | `s1-live-summary-pr.png`; `window.__qaMarker332` survived unchanged from before-send to after-render, proving no navigation occurred |
| S2 | Same live PR → session-row glyph + "has PR" filter match, no reload | happy | ui | PASS | `s2-haspr-filter.png`; `sessions-row-meta-pr` visible on the chat's row, row survives the `has-pr` filter toggle |
| S3 | Same PR detected twice in one turn → exactly one entry, no dup/flicker | edge | ui+api | PASS | `s3-dedupe.png`; DOM has 1 `session-panel-summary-pr-*` node, `GET /api/chats` shows `detectedPrs.length === 1` |
| S4 | Session backgrounded after its PR is detected → glyph survives, reopen still shows the PR (no regression) | regression | ui | PASS | `s4-background-reopen.png`; glyph visible while chat A was backgrounded (chat B active), PR row visible again after reopening chat A |

Burst-coalescing (a burst of `chat.prDetected`/other reload triggers must not
storm the daemon) is pinned by the branch's own unit test
(`use-session-list-router.test.tsx` — "coalesces a burst into leading + one
trailing reload") and wasn't re-driven live; that's a debounce-timing property
a fake-timer unit test asserts more precisely than a live probe could.

## Notable dead end (test-harness gotcha, not a product bug)

The first two live attempts (S1/S2 rewrites) timed out waiting for the Summary
PR row even though the WS frame carrying `chat.prDetected` visibly arrived at
the client (confirmed via `page.on('websocket')` frame logging) and
`GET /api/chats` showed `detectedPrs` populated correctly. Root cause: the
Session panel is a light-dismiss overlay
(`packages/ui/src/features/session-panel/SessionPanel.tsx`) — clicking the
composer to send the second turn closed it before the assertion ran. Fixed by
opening the panel *after* the PR-detecting turn completes, which is also the
more faithful rendition of the acceptance criterion (the data must be live
before the panel opens, not the panel-open moment itself).

## Notes

- All four detected-PR chats and the fixtures directory
  (`/tmp/mf-qa-332-fixtures`) are scaffolding under `/tmp`, not committed.
- The shared dev data dir (`~/.mainframe_dev`) carries prior QA runs' chats;
  this probe filtered to `qa327`-project chats by `createdAt` and never
  touched other projects' data.
