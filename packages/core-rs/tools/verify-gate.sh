#!/usr/bin/env bash
# Greps crates/ for forbidden patterns:
#   unsafe, todo!(, unimplemented!(, panic!(, static mut, lazy_static,
#   std::thread::spawn, anyhow, and .unwrap()/.expect() (the last two are
#   exempted inside #[cfg(test)] modules and mainframe-daemon/src/main.rs
#   boot code, per the documented rule).
#
# Exit non-zero with a listing of every violation on any match.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRATES_DIR="$SCRIPT_DIR/../crates"

# The gate parses Cargo manifests with `tomllib` (Python 3.11+). macOS ships
# 3.9 as `python3`, so prefer a newer interpreter when the default is too old.
pick_python() {
  for candidate in python3 python3.14 python3.13 python3.12 python3.11; do
    if command -v "$candidate" >/dev/null 2>&1 \
      && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
      echo "$candidate"
      return 0
    fi
  done
  echo "verify-gate: needs Python 3.11 or newer on PATH (for tomllib); found $(python3 --version 2>&1)" >&2
  return 1
}
# Exit 3, not 1, so the pre-commit hook can tell "cannot run" from "found
# violations" and skip with a warning; CI fails on either.
PYTHON="$(pick_python)" || exit 3

"$PYTHON" -m unittest discover -s "$SCRIPT_DIR" -p "test_verify_gate.py"
"$PYTHON" "$SCRIPT_DIR/verify_gate.py" "$CRATES_DIR"
