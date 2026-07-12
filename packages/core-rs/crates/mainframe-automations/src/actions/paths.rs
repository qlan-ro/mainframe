//! Containment for user-authored paths (A1). Duplicates the SECURITY-critical
//! tail of `mainframe-server::path_utils::resolve_and_validate_path` — the
//! dependency points the other way (server → automations), so the engine
//! carries its own copy. Canonicalize (realpath) both ends, then require the
//! target to sit at or strictly beneath the base.

use std::path::Path;

/// True when `real_target` is `real_base` itself or lies strictly beneath it.
/// `Path::starts_with` compares whole components, so `/proj-evil` never
/// passes for base `/proj` (the separator-boundary guard).
fn is_within_base(real_base: &Path, real_target: &Path) -> bool {
    real_target == real_base || real_target.starts_with(real_base)
}

/// Resolves `requested_path` relative to `base_path` and confirms containment.
/// `None` = escapes the base or does not exist — treat as forbidden, never
/// fall back to an unvalidated path.
pub(crate) async fn resolve_and_validate_path(
    base_path: &str,
    requested_path: &str,
) -> Option<String> {
    let real_base = tokio::fs::canonicalize(base_path).await.ok()?;
    // `Path::join` mirrors Node's `path.resolve(base, requested)`: an
    // absolute `requested` replaces the base; a relative one is appended.
    let joined = Path::new(base_path).join(requested_path);
    let full_path = tokio::fs::canonicalize(&joined).await.ok()?;
    is_within_base(&real_base, &full_path).then(|| full_path.to_string_lossy().into_owned())
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T6.3), not a TS port
// confidence: high
// todos: 0
// notes: mirror of mainframe-server/src/path_utils.rs (itself the port of
//        server/routes/path-utils.ts resolveAndValidatePath).
