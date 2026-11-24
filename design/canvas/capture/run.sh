#!/usr/bin/env bash
# Re-captures one area's product boards from the running app (mock mode), or only the boards named after it:
#   bash design/canvas/capture/run.sh shell
#   bash design/canvas/capture/run.sh shell Shell-Window Shell-States
# CAPTURE_SKIP_BUILD=1 reuses the UI bundle of the previous run. See README.md.
set -euo pipefail
cd "$(dirname "$0")"
HERE=$PWD
AREA=${1:?usage: run.sh <area> [board …]}
shift
[ -f "areas/$AREA.mts" ] || { echo "no areas/$AREA.mts; areas: $(cd areas && echo *.mts | sed 's/\.mts//g')" >&2; exit 2; }

# Ports of its own, so a capture never meets a dev app or an e2e run.
export MF_E2E_DAEMON_PORT=${MF_E2E_DAEMON_PORT:-31516}
export MF_E2E_PREVIEW_PORT=${MF_E2E_PREVIEW_PORT:-4399}
export E2E_MODE=mock
# The seeded repositories are made with git's own defaults, not this machine's config.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export CAPTURE_AREA=$AREA
CAPTURE_BOARDS=$(IFS=,; echo "$*")
export CAPTURE_BOARDS
[ "${CAPTURE_SKIP_BUILD:-0}" = 1 ] && export MF_E2E_SKIP_BUILD=1

rm -rf .work
mkdir .work
pnpm --dir ../../../packages/e2e exec playwright test -c "$HERE/playwright.config.mts"
python3 build.py "$AREA"
node ../../tools/check.mjs
