//! Ported from `src/server/routes/path-utils.ts`.
//!
//! SECURITY-critical: `resolve_and_validate_path` canonicalizes (realpath) and
//! then confirms strict containment within the base, closing path-traversal and
//! sibling-prefix seams. The TS used `realpathSync`; the port uses async
//! `tokio::fs::canonicalize` (PORTING.md forbids sync I/O in the daemon) — the
//! semantics (resolve symlinks, fail-closed on non-existent/escaping paths) are
//! identical.

use std::path::{Path, PathBuf};

/// True when `real_target` is `real_base` itself or lies strictly beneath it.
/// The separator guard is security-critical: a bare `starts_with` on the string
/// would admit a sibling like `/proj-evil` for base `/proj`. A filesystem root
/// already ends in the separator, so a second one must not be appended.
pub fn is_within_base(real_base: &Path, real_target: &Path) -> bool {
    if real_target == real_base {
        return true;
    }
    // `Path::starts_with` compares whole components, so `/proj` does NOT
    // "start with" `/proj-evil` and vice-versa — this is exactly the
    // separator-boundary guard the TS `realBase + sep` string check provided.
    real_target.starts_with(real_base)
}

/// Resolves `requested_path` relative to `base_path` and confirms it is
/// contained within `base_path` (realpath + containment). Returns the resolved
/// absolute path or `None` if the path escapes the base or does not exist.
///
/// Callers MUST obtain `base_path` from the effective-path resolver first; never
/// pass a raw user-supplied string as `base_path`. Treat `None` as forbidden
/// (403) — never fall back to an unvalidated path.
pub async fn resolve_and_validate_path(base_path: &str, requested_path: &str) -> Option<String> {
    let real_base = tokio::fs::canonicalize(base_path).await.ok()?;
    // `Path::join` mirrors Node's `path.resolve(base, requested)`: an absolute
    // `requested` replaces the base entirely; a relative one is appended.
    let joined = Path::new(base_path).join(requested_path);
    let full_path = tokio::fs::canonicalize(&joined).await.ok()?;
    is_within_base(&real_base, &full_path).then(|| path_to_string(&full_path))
}

/// Allow reading files under `~/.claude/` (plans, skills, …) when the path
/// resolves outside the project directory. Mirrors `resolveClaudeConfigPath`.
pub async fn resolve_claude_config_path(base_path: &str, requested_path: &str) -> Option<String> {
    let claude_dir = tokio::fs::canonicalize(claude_dir()?).await.ok()?;
    let joined = Path::new(base_path).join(requested_path);
    let full_path = tokio::fs::canonicalize(&joined).await.ok()?;
    is_within_base(&claude_dir, &full_path).then(|| path_to_string(&full_path))
}

/// Resolve a requested path for reading: validated inside the project base, or —
/// as a fallback — under `~/.claude/`. Mirrors `resolveReadablePath`.
pub async fn resolve_readable_path(base_path: &str, requested_path: &str) -> Option<String> {
    match resolve_and_validate_path(base_path, requested_path).await {
        Some(p) => Some(p),
        None => resolve_claude_config_path(base_path, requested_path).await,
    }
}

fn claude_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude"))
}

fn path_to_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    /// Realpath of a str, for building the expected canonical results the way the
    /// TS test's `fs.realpathSync(tmpDir)` does (macOS `/tmp` → `/private/tmp`).
    fn real(path: &Path) -> String {
        fs::canonicalize(path)
            .unwrap()
            .to_string_lossy()
            .into_owned()
    }

    #[tokio::test]
    async fn returns_full_path_for_valid_sub_path() {
        let tmp = tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("src")).unwrap();
        fs::write(tmp.path().join("src/index.ts"), "// hello").unwrap();
        let base = tmp.path().to_string_lossy();
        let result = resolve_and_validate_path(&base, "src/index.ts").await;
        assert_eq!(
            result.as_deref(),
            Some(real(&tmp.path().join("src/index.ts")).as_str())
        );
    }

    #[tokio::test]
    async fn returns_full_path_for_directory_sub_path() {
        let tmp = tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("src")).unwrap();
        let base = tmp.path().to_string_lossy();
        let result = resolve_and_validate_path(&base, "src").await;
        assert_eq!(
            result.as_deref(),
            Some(real(&tmp.path().join("src")).as_str())
        );
    }

    #[tokio::test]
    async fn returns_null_for_path_traversal_attempts() {
        let tmp = tempdir().unwrap();
        let base = tmp.path().to_string_lossy();
        assert_eq!(
            resolve_and_validate_path(&base, "../../etc/passwd").await,
            None
        );
    }

    #[tokio::test]
    async fn returns_null_for_absolute_paths_outside_base() {
        let tmp = tempdir().unwrap();
        let base = tmp.path().to_string_lossy();
        assert_eq!(resolve_and_validate_path(&base, "/etc/passwd").await, None);
    }

    #[tokio::test]
    async fn returns_null_for_non_existent_paths() {
        let tmp = tempdir().unwrap();
        let base = tmp.path().to_string_lossy();
        assert_eq!(
            resolve_and_validate_path(&base, "does-not-exist.txt").await,
            None
        );
    }

    #[tokio::test]
    async fn returns_null_when_base_path_itself_does_not_exist() {
        assert_eq!(
            resolve_and_validate_path("/nonexistent-base-path-12345", "file.txt").await,
            None
        );
    }

    #[tokio::test]
    async fn returns_full_path_for_current_directory_reference() {
        let tmp = tempdir().unwrap();
        let base = tmp.path().to_string_lossy();
        let result = resolve_and_validate_path(&base, ".").await;
        assert_eq!(result.as_deref(), Some(real(tmp.path()).as_str()));
    }

    #[tokio::test]
    async fn treats_a_filesystem_root_base_as_containing_everything() {
        // is_within_base('/', canonical(tmp)) must be true — no double-separator.
        let tmp = tempdir().unwrap();
        let target = fs::canonicalize(tmp.path()).unwrap();
        let root = target.ancestors().last().unwrap(); // "/"
        let rel = target.strip_prefix(root).unwrap();
        let result =
            resolve_and_validate_path(&root.to_string_lossy(), &rel.to_string_lossy()).await;
        assert_eq!(result, Some(target.to_string_lossy().into_owned()));
    }

    #[tokio::test]
    async fn returns_null_for_a_sibling_directory_sharing_the_base_name_prefix() {
        // Boundary: base "<tmp>/proj" must NOT admit "<tmp>/proj-evil".
        let tmp = tempdir().unwrap();
        let base = tmp.path().join("proj");
        let sibling = tmp.path().join("proj-evil");
        fs::create_dir_all(&base).unwrap();
        fs::create_dir_all(&sibling).unwrap();
        fs::write(sibling.join("secret.txt"), "top secret").unwrap();
        let result =
            resolve_and_validate_path(&base.to_string_lossy(), "../proj-evil/secret.txt").await;
        assert_eq!(result, None);
    }
}

// PORT STATUS: src/server/routes/path-utils.ts (4 helpers)
// confidence: high
// todos: 0
// notes: `realpathSync` → async `tokio::fs::canonicalize` (no sync I/O in the
// daemon). `isWithinBase`'s string prefix + separator guard → `Path::starts_with`
// (component-wise, so the `/proj` vs `/proj-evil` sibling seam stays closed — the
// dedicated test proves it). Node `path.resolve(base, requested)` (absolute
// requested wins) → `Path::join`. All 9 path-utils.test.ts cases translated with
// real tempdirs (real collaborators, no mocks).
