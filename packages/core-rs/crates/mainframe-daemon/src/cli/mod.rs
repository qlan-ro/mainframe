//! Ported from `packages/core/src/cli/*` — the `pair` and `status` subcommands.
//!
//! `--version`/`version` is answered inline in `main` (before logging init), so no
//! module here; `update` (self-update) is not ported (see `main`). Each subcommand
//! is a thin HTTP client against the running daemon's loopback API.

pub mod pair;
pub mod status;

// PORT STATUS: src/cli/ (pair.ts + status.ts)
// confidence: medium
// notes: reqwest clients hitting the loopback daemon; qrcode-terminal → the qrcode
// crate's Dense1x2 unicode renderer. update.ts (self-update) is intentionally not
// ported (a packaging concern, not part of Task 5.5's CLI scope).
