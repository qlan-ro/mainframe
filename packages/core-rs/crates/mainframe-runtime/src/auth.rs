//! Ported from `src/auth/index.ts` (re-exports).

pub mod token;
pub mod validate_authed_token;

pub use token::{TokenPayload, generate_pairing_code, generate_token, validate_token};
pub use validate_authed_token::{DeviceLookup, validate_authed_token};

// PORT STATUS: src/auth/index.ts (2 lines)
// confidence: high
// todos: 0
// notes: index.ts re-exports generateToken/validateToken/generatePairingCode +
// the TokenPayload type. validateAuthedToken is imported directly in the TS tree
// (not via index.ts); it is re-exported here for ergonomics alongside its
// `DeviceLookup` trait (the port's stand-in for the `DevicesRepository` argument).
