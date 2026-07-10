//! Ported from `packages/core/src/background-tasks/spool-root.ts`.

use std::path::PathBuf;

/// Best-effort current-user uid, mirroring `process.getuid()`.
///
/// `getuid(2)` is only reachable through `libc`/`rustix`, neither of which is on
/// the workspace allowlist, so this returns `None` until that dependency is
/// added (see the crate blocker). Every test path injects an explicit
/// `spoolRoot`, so only the production default below is affected.
fn current_uid() -> Option<u32> {
    // TODO(port): getuid() needs libc/rustix (not in the workspace allowlist).
    None
}

/// Absolute path of the Claude CLI's per-user spool root.
///  - Linux/mac: `/tmp/claude-{uid}`
///  - Win: `%TEMP%/claude`
///  - `CLAUDE_CODE_TMPDIR` overrides the base.
pub fn spool_root() -> PathBuf {
    let tmpdir = std::env::var("CLAUDE_CODE_TMPDIR").ok().unwrap_or_else(|| {
        if cfg!(windows) {
            std::env::temp_dir().to_string_lossy().into_owned()
        } else {
            "/tmp".to_string()
        }
    });
    let uid_part = if cfg!(windows) {
        "claude".to_string()
    } else {
        format!("claude-{}", current_uid().unwrap_or(0))
    };
    PathBuf::from(tmpdir).join(uid_part)
}

// PORT STATUS: src/background-tasks/spool-root.ts (15 lines)
// confidence: medium
// todos: 1
// notes: BLOCKER — `process.getuid()` has no allowlisted Rust equivalent (needs
// libc/rustix). `current_uid()` returns None → the production default falls back
// to `claude-0`, which is WRONG on a non-root macOS/Linux daemon. Not exercised
// by any test (reconcile/kill inject spoolRoot); flagged for the phase that adds
// libc. `os.tmpdir()` → `std::env::temp_dir()`; win32 branch mirrors `claude`.
