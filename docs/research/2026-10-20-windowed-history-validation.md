# Windowed history validation

The implementation follows the [windowed history spec](../specs/2026-10-19-windowed-transcript-history.md). [PR #855](https://github.com/qlan-ro/mainframe/pull/855) contains the independently shippable daemon change; [PR #856](https://github.com/qlan-ro/mainframe/pull/856) contains desktop adoption and the reference measurement. The client PR temporarily targets main so CI checks the combined stack. Merge the daemon first.

## Protocol and static checks

- ACP selection, revision replay, paging, search, preview and streaming: 259 tests passed; the manual release measurement is ignored by default.
- Server ACP hub/dispatch: 82 tests passed, including independent floors, detach, page ordering and racing deltas.
- Chat crate: 632 unit tests and 6 integration tests passed. Strict clippy, the Rust repository gate and golden protocol fixtures pass.
- A warm display-snapshot read borrows settled projection storage and copies 40 of 500 containers.
- UI assertions passed across the full local run and retries of nine workers that timed out during startup. UI/e2e TypeScript checks pass; UI lint has no errors and 226 existing compiler/advisory warnings.
- CI on daemon head `95024f2c` and combined head `456795f6` passed Rust, UI/types/tools tests, typecheck and changeset checks.

## Runtime checks

Three direct-WebSocket scenarios pass against the real release daemon and generated 33 MB mock recording. They cover bounded replay, contiguous load-through, exact prose search excluding tool output, compressed pages, independent connection floors, revision reconnect and legacy replay.

Chromium checks cover the newest window, upward-gesture paging without chains, prepend compensation with native anchoring disabled, full-chat find, one-request load-through, chat return, idle socket reconnect, daemon resync, compact disclosure persistence and Activity paging while pinned. Measurement regressions separately check that keyboard-handler time is included and an unrelated chat's replay cannot complete the timer.

Native WebKit QA used an isolated packaged app, data directory, mock adapter and ports. The initial view had 20 recent user messages; an explicit page brought 40 while retaining the original message position with 0 px movement. Find reported 1/1 without loading history, then revealed and highlighted the early match. Tool-only text reported 0/0. Light/verbose and dark/compact views were inspected, including a 900×800 logical-pixel window at Compact UI scale.

QA found and fixed a 16 px jump when the Earlier button became a shorter Loading row. The boundary now keeps a 48 px minimum height. The browser regression checks the anchor before loading, during loading and after prepend. A real-component test verifies that find opens a closed provider work turn; the mock replay lacks the presentation metadata needed for that assertion.

Screenshots and the scenario report are retained under `/tmp/live-qa/windowed-history-20261020`. GitHub attachment upload requires Chrome extension file access, which was not expanded. No native live-stream reconnect is claimed: runtime reconnect used an idle chat; Rust tests cover in-flight page/live ordering. The run-owned native processes were stopped.

## Reference measurement

The release-mode protocol fixture has 500 containers, 2,500 items and a 33,417,541-byte full encoding. A local preparation measurement recorded 30.35 ms for the one-time revision seed and 2.12 ms for window preparation, producing 1,447,261 uncompressed window bytes. These are protocol preparation figures, not click-to-paint timings. The seed is below the 150 ms relocation threshold locally.

The browser harness runs 10 fresh daemons per scenario for windowed, current full and uncompressed full replay. Memory rows warm history before the measured click; JSONL rows remove history snapshots. Each run clones the fixture database and removes copied logs.

Input timing starts at window-capture keydown or row click, before application handlers. Completion requires the measured chat's replay marker, the visible tail, no loading spinner and two animation frames. Wire measurement observes native WebSocket delivery passively; only legacy initialization options are changed. Raw samples are attached to the Playwright report and printed in the job log.

Run the existing manual `e2e-mock` workflow on the client branch to include the performance test. Locally, run the windowed-history specs with `E2E_MODE=mock MF_E2E_HISTORY_PERF=1`, the release daemon and a renderer built for the dedicated test port. Do not rebuild that shared renderer during the run.

Record the CI run's exact head, p95 table and raw samples in PR #856 before marking it ready. The gates remain 400 ms warm open, 400 ms above logged cold history-load time, 150 ms switch-back, 300 ms prepend, under 3 MB and 10% of full replay, at least 50 fps and at most 100 ms keypress-to-paint at 400 loaded containers. Virtualization is conditional on the last two thresholds.
