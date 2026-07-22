#!/bin/zsh
# Full local sweep of the app-tauri e2e suite: one playwright invocation per spec file
# (multi-file runs share one 40-min globalTimeout and starve the tail). Assumes the UI
# bundle is already built for the e2e daemon port:
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
  tail -6 "$OUT/$name.log" | grep -E '[0-9]+ (passed|failed|skipped|did not run|flaky|interrupted)' | tr '\n' ' ' | \
    xargs -I{} echo "$name: exit=$code {}" >> "$OUT/summary.txt"
  grep -qE '[0-9]+ (passed|failed)' "$OUT/$name.log" || echo "$name: exit=$code NO-SUMMARY" >> "$OUT/summary.txt"
done
echo "SWEEP DONE" >> "$OUT/summary.txt"
