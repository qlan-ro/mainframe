//! Ported from `src/auth/*`.
//!
//! TODO(port): token generation/validation (`src/auth/token.ts`,
//! `src/auth/validate-authed-token.ts`) is not yet ported. `/health` is on the
//! `publicPaths` allowlist (see `docs/rust-port/CONTRACT/routes.json`) and does
//! not require auth, so the scaffold daemon has no auth-gated routes yet.

// PORT STATUS: src/auth/* (not yet ported)
// confidence: low
// todos: 1
// notes: empty placeholder module; real port deferred to Phase 3 (server: HTTP + WS).
