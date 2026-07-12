//! Ported from `packages/core/src/plugins/security/` — manifest validation.

pub mod manifest_validator;

pub use manifest_validator::validate_manifest;

// PORT STATUS: src/plugins/security/ (module barrel)
// confidence: high
// todos: 0
// notes: only manifest-validator.ts lives under security/.
