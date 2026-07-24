//! Ported from `packages/core/src/cli/*` — the `pair`, `status`, and `update`
//! subcommands.
//!
//! `--version`/`version` is answered inline in `main` (before logging init), so no
//! module here. `pair` and `status` are thin HTTP clients against the running
//! daemon's loopback API; `update` self-updates a standalone install in place.

pub mod pair;
pub mod status;
pub mod update;

/// `Cannot reach daemon at %s. Is it running?` — shared by every subcommand that
/// needs the daemon to already be running.
pub(crate) fn connect_failure_message(base_url: &str) -> String {
    format!("Cannot reach daemon at {base_url}. Is it running?")
}

// PORT STATUS: src/cli/ (pair.ts + status.ts + update.ts)
// confidence: medium
// notes: reqwest clients hitting the loopback daemon; qrcode-terminal → the qrcode
// crate's Dense1x2 unicode renderer. update.ts's tar extraction shells out to the
// system `tar` rather than a Rust tar/gzip crate.
