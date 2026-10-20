# Windowed history validation

The implementation follows the [windowed history spec](../specs/2026-10-19-windowed-transcript-history.md). The daemon/protocol change can ship independently; the desktop opt-in needs the runtime checks below before release.

## Completed checks

- ACP selection, revision replay, paging, search, preview and stream tests: 259 passed; the manual release measurement is ignored by default.
- Server ACP hub/dispatch tests: 82 passed, including independent floors, detach, page ordering and racing deltas.
- Borrowed display-snapshot regression: a warm read retains the projection's settled storage and copies 40 of 500 containers.
- Rust golden fixtures and TypeScript protocol fixtures pass. Strict clippy and the Rust repository gate pass.
- UI assertions pass across the full-suite run and retries of nine workers that timed out during startup. The initial metadata assertion failures were updated to check stable search item IDs. Separate regressions cover focused split-chat find ownership and paging during resume.
- UI and e2e TypeScript checks pass. UI lint has existing compiler/advisory warnings and no errors.

## Local protocol measurement

The release-mode `reference_transcript_measurement` test uses 500 containers, 2,500 items and a 33,417,541-byte full encoding. One local run measured a 30.35 ms revision seed and 2.12 ms window preparation, producing 1,447,261 uncompressed bytes for the window.

These are protocol preparation measurements, not click-to-paint latency or CI results. The seed is below the spec's 150 ms threshold in this local run. The warm-resume path borrows the display projection instead of cloning the complete snapshot.

## Runtime checks still required

The new `windowed-history.spec.ts` exercises bounded opening, gesture-gated prepend anchoring with native anchoring disabled, whole-chat find, and one-request load-through. The performance spec runs ten fresh daemons per scenario for windowed, current full replay, and uncompressed full replay. It attaches raw measurements and checks p95 open/switch/page timing, uncompressed bytes, scroll rate, composer latency and heap at 400 containers.

Run the standard e2e command with `MF_E2E_HISTORY_PERF=1` and the two `windowed-history` specs on the e2e CI runner. Use the release daemon and rebuild the renderer for that run's dedicated daemon port. The JSONL row removes history snapshots; the memory row warms history before the measured click. Each run starts from a cloned fixture database with copied logs removed.

Local runtime verification was blocked: both headed and headless Chromium failed during macOS process bootstrap before opening a page. The native Tauri shell compiled and its bridge connected, but macOS never created its main window. No screenshots or WebKit prepend result were obtained. The computer-use service was also unavailable.

Before release, run the browser specs, record the CI performance table, and check native WebKit prepend anchoring, compact disclosure stability, activity/subagent jumps, reconnect/resync, light/dark themes and a narrow viewport. Virtualization remains conditional on the measured 50 fps / 100 ms thresholds; no threshold result is claimed here.
