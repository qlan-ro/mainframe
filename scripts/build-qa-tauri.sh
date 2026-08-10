#!/usr/bin/env bash
set -euo pipefail

# Builds the packaged-QA Tauri variant: the mcp-bridge plugin compiled in via
# the mcp-bridge-qa feature, plus the tauri.qa.conf.json overlay (global Tauri
# IPC, relaxed script-src). Debug profile, app bundle only — never a dmg, so
# this output can't be mistaken for a release artifact. Unsigned; not the
# release pipeline. See docs/guides/packaged-tauri-qa.md.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# The renderer bakes these in at build time (Vite has no runtime env); an
# ambient dev DAEMON_PORT/MAINFRAME_DATA_DIR would pin the QA bundle to a stale
# port or data dir. The shell resolves its real port at runtime through
# get_daemon_port, so the bundle must be built with these unset and given
# isolated values later, at launch (.agents/launch-test-tauri-qa.sh).
unset DAEMON_PORT VITE_PORT VITE_DAEMON_PORT VITE_DAEMON_HTTP_PORT VITE_DAEMON_WS_PORT MAINFRAME_DATA_DIR

BUNDLE_DIR="$ROOT/packages/app-tauri/src-tauri/target/debug/bundle/macos"
APP_PATH="$BUNDLE_DIR/Mainframe.app"

echo "==> building packaged-QA Tauri app (debug profile, mcp-bridge-qa feature)"
(
  cd "$ROOT/packages/app-tauri" && \
  pnpm exec tauri build \
    --debug \
    --bundles app \
    --features mcp-bridge-qa \
    --config src-tauri/tauri.qa.conf.json \
    --config '{"bundle":{"createUpdaterArtifacts":false}}'
)

if [ ! -d "$APP_PATH" ]; then
  echo "error: expected QA app bundle not found at $APP_PATH" >&2
  exit 1
fi

CF_BUNDLE_EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP_PATH/Contents/Info.plist")"

echo "QA_APP=$APP_PATH"
echo "CFBundleExecutable=$CF_BUNDLE_EXECUTABLE"
echo "note: this artifact is unsigned and is not a release build."
