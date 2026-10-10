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

python3 -m unittest discover -s "$SCRIPT_DIR" -p "test_verify_gate.py"
python3 "$SCRIPT_DIR/verify_gate.py" "$CRATES_DIR"
