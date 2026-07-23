#!/bin/zsh
# Full local sweep of the app-tauri e2e suite: one playwright invocation per spec file
# (multi-file runs share one 40-min globalTimeout and starve the tail). The suite runs against
# the Rust daemon (fixtures/daemon.ts resolves packages/core-rs/target/{release,debug}/mainframe-daemon,
# auto-building on first run). Assumes the UI bundle is already built for the e2e daemon port:
#   VITE_DAEMON_PORT=31416 pnpm --filter @qlan-ro/mainframe-ui build
# Per-spec logs + a one-line-per-spec summary land in logs/tauri-sweep/.
set -u
cd "$(dirname "$0")"
OUT=logs/tauri-sweep
rm -rf "$OUT" && mkdir -p "$OUT"
: > "$OUT/summary.txt"
for spec in tests-tauri/*.spec.ts; do
  name=$(basename "$spec" .spec.ts)
  MF_E2E_SKIP_BUILD=1 E2E_MODE=mock npx playwright test --project=tauri "$spec" > "$OUT/$name.log" 2>&1
  code=$?
  # Playwright prints its count summary as separate anchored lines ("  12 skipped\n  8 passed (…)")
  # at the very end, but a trailing "To open last HTML report" footer can push earlier count lines
  # out of a fixed tail window (that silently dropped skip counts). Scan the WHOLE log instead: the
  # anchor (leading space + digits + keyword) matches only the summary counts — per-test progress
  # lines carry ✓/✘ and test-name lines start with the [project] tag or ›, so neither can match.
  counts=$(grep -E '^[[:space:]]*[0-9]+ (passed|failed|skipped|did not run|flaky|interrupted)' \
    "$OUT/$name.log" | sed -E 's/^[[:space:]]+//' | paste -sd' ' -)
  echo "$name: exit=$code ${counts:-NO-SUMMARY}" >> "$OUT/summary.txt"
done
echo "SWEEP DONE" >> "$OUT/summary.txt"
