//! Boot-set login-shell `PATH` for the `lsof`/`kill`/`pgrep`/`ps` spawns.
//!
//! The TS twin relied on `enrichPath` having mutated `process.env.PATH`, so these
//! system-utility spawns inherited the enriched `PATH`. Under edition 2024
//! `std::env::set_var` is `unsafe` (this crate is `#![forbid(unsafe_code)]`), so
//! the daemon threads the resolved value here once at boot via
//! [`set_resolved_path`]. It is applied as an `env("PATH", …)` override on each
//! spawn. `lsof`/`kill`/`pgrep`/`ps` live on the bare launchd `PATH`, so this is
//! belt-and-suspenders parity rather than a hard requirement — but it keeps the
//! spawn env identical to what the TS daemon produced.
//!
//! This is a write-once `OnceLock` (not a mutable env var): safe, set exactly
//! once at boot before any task work runs.

use std::sync::OnceLock;

static RESOLVED_PATH: OnceLock<String> = OnceLock::new();

/// Set the boot-resolved login-shell `PATH`. Idempotent: only the first call
/// wins (later calls are ignored), matching the once-at-boot contract.
pub fn set_resolved_path(path: impl Into<String>) {
    let _ = RESOLVED_PATH.set(path.into());
}

/// The boot-resolved `PATH`, if the daemon set one. `None` in tests / when unset
/// (spawns then inherit the process `PATH`).
pub(crate) fn resolved_path() -> Option<&'static str> {
    RESOLVED_PATH.get().map(String::as_str)
}

/// Apply the boot-resolved `PATH` to `command` as an `env("PATH", …)` override
/// when one was set at boot; otherwise leave the inherited `PATH` untouched.
pub(crate) fn apply(command: &mut tokio::process::Command) {
    if let Some(path) = resolved_path() {
        command.env("PATH", path);
    }
}
