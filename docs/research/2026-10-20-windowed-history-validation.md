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

Cold opening also exposed concurrent REST lifecycle restore and ACP replay: the restore's resync requested a second replay. Both fresh and previously background-loaded controllers now finish lifecycle warm-up before attaching the facade, then recheck activation and client identity. The 370-test controller suite passes, including restore failure and deactivation during warm-up. The focused browser run passed 26 scenarios with four existing skips.

Screenshots and the scenario report are retained under `/tmp/live-qa/windowed-history-20261020`. GitHub attachment upload requires Chrome extension file access, which was not expanded. No native live-stream reconnect is claimed: runtime reconnect used an idle chat; Rust tests cover in-flight page/live ordering. The run-owned native processes were stopped.

## Reference measurement

The release-mode protocol fixture has 500 containers, 2,500 items and a 33,417,541-byte full encoding. A local preparation measurement recorded 30.35 ms for the one-time revision seed and 2.12 ms for window preparation, producing 1,447,261 uncompressed window bytes. These are protocol preparation figures, not click-to-paint timings. The seed is below the 150 ms relocation threshold locally.

The browser harness runs 10 fresh daemons per scenario for windowed, current full and uncompressed full replay. Memory rows warm history before the measured click; JSONL rows remove history snapshots. Each run clones the fixture database and removes copied logs.

The initial session is a separate empty chat. Before the measured click, the harness asserts no resume request has targeted the reference chat and no cold history-load log exists; opening must issue exactly one resume.

Input timing starts at window-capture keydown or row click, before application handlers. Completion requires the measured chat's replay marker, the visible tail, no loading spinner and two animation frames. Wire measurement observes native WebSocket delivery passively; only legacy initialization options are changed. Raw samples are attached to the Playwright report and printed in the job log.

Run the existing manual `e2e-mock` workflow on the client branch to include the performance test. Locally, run the windowed-history specs with `E2E_MODE=mock MF_E2E_HISTORY_PERF=1`, the release daemon and a renderer built for the dedicated test port. Do not rebuild that shared renderer during the run.

Record the CI run's exact head, p95 table and raw samples in PR #856 before marking it ready. The gates remain 400 ms warm open, 400 ms above logged cold history-load time, 150 ms switch-back, 300 ms prepend, under 3 MB and 10% of full replay, at least 50 fps and at most 100 ms keypress-to-paint at 400 loaded containers. CI run `39395567605` on `d5474ac7` triggered Phase 3: the second attempt measured 28.31 fps at 400 loaded containers. Warm open was 612.4 ms, cold open 689.7 ms (576.7 ms above logged history load), switch-back 231 ms, prepend 226.8 ms, keypress-to-paint 32.2 ms and window replay 1,452,756 bytes. The suite had 437 passes, 36 skips and two failures: the performance gates and a reconnect scroll assertion. These results establish the pre-virtualization baseline; they are not acceptance results.

## Virtualization follow-up

The follow-up uses the existing react-virtuoso dependency with the transcript's native viewport. The existing bottom-pin controller owns following and initial position. Prepend restores the visible message until measurements settle; pinned loads hand following back even while the tail grows. Disclosure choices, fetched full output and clamped prompt expansion survive row unmounts. Find and Activity distinguish loaded messages from mounted rows before requesting history.

Whole-chat daemon find keeps its total independent of mounted rows. For older daemons, opening legacy DOM find mounts the loaded transcript and observes text changes, preserving the selected occurrence on a same-query rescan. Cross-message selection remains native text selection; the existing assistant-ui toolbar supports a selection within one message.

Focused Chromium scenarios pass for bounded row mounting at 400 loaded containers, text selection and Quote, retained tool disclosure/full output, and legacy find into offscreen history. The full-output retention scenario stubs the HTTP response because the mock adapter has no native tool-result file. The local 60-sample run passed every gate: warm open p95 316.3 ms, cold open p95 393.5 ms (338.99 ms above logged load), switch-back 76.5 ms, prepend 142.2 ms, window bytes 1,453,019, minimum scrolling 81.03 fps and keydown-to-paint p95 17.2 ms. The uncompressed full-replay warm baseline was 1,645.3 ms and 33,770,959 bytes; current full replay was 470.9 ms and 3,992,711 bytes. The same virtual renderer was used for all replay modes. CI performance and final native WebKit acceptance are pending.
