//! Ported from `packages/core/src/plugins/builtin/codex/transcript.ts`.

use std::collections::HashMap;
use std::path::PathBuf;

use crate::thread_registry::{AgentMetadata, lookup_agent_metadata};

/// Registry lookup — injectable for tests; defaults to Codex's state DB.
/// `Send + Sync` so the `Adapter::is_transcript_present` override yields a `Send`
/// future (the trait boxes futures as `Send`).
pub type LookupFn<'a> = dyn Fn(&[String]) -> HashMap<String, AgentMetadata> + Send + Sync + 'a;

#[derive(Default)]
pub struct CodexTranscriptDeps<'a> {
    /// Registry lookup — injectable for tests; defaults to `lookup_agent_metadata`.
    pub lookup: Option<&'a LookupFn<'a>>,
    /// Sessions root the rollout must live under — injectable for tests.
    pub sessions_root: Option<PathBuf>,
}

/// `~/.codex/sessions`.
fn default_sessions_root() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".codex").join("sessions"))
}

/// Whether the Codex rollout transcript for `thread_id` still exists on disk.
/// Returns `None` (cannot determine — don't flag) when the state DB has no row,
/// the row carries no rollout path, or the path escapes `~/.codex/sessions`
/// (untrusted input, mirrors rollout-reader.rs containment). `Some(false)` when
/// the rollout file was deleted, `Some(true)` when it is present and contained.
pub async fn is_codex_transcript_present(
    thread_id: &str,
    deps: Option<&CodexTranscriptDeps<'_>>,
) -> Option<bool> {
    let ids = [thread_id.to_string()];
    let metadata = match deps.and_then(|d| d.lookup) {
        Some(lookup) => lookup(&ids),
        None => lookup_agent_metadata(&ids),
    };
    let rollout_path = metadata.get(thread_id).and_then(|m| m.rollout_path.clone());
    let rollout_path = match rollout_path {
        Some(p) if !p.is_empty() => p,
        _ => return None,
    };

    let resolved = match tokio::fs::canonicalize(&rollout_path).await {
        Ok(p) => p,
        // Expected: rollout file deleted.
        Err(_) => return Some(false),
    };

    let root_base = deps
        .and_then(|d| d.sessions_root.clone())
        .or_else(default_sessions_root)?;
    // Expected: root may not exist yet — compare against the literal path.
    let root_resolved = tokio::fs::canonicalize(&root_base)
        .await
        .unwrap_or(root_base);
    if !resolved.starts_with(&root_resolved) {
        return None;
    }
    Some(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    const THREAD_ID: &str = "thread-abc";

    fn lookup_with(
        rollout_path: Option<String>,
    ) -> impl Fn(&[String]) -> HashMap<String, AgentMetadata> {
        move |_ids: &[String]| {
            let mut m = HashMap::new();
            m.insert(
                THREAD_ID.to_string(),
                AgentMetadata {
                    nickname: None,
                    role: None,
                    rollout_path: rollout_path.clone(),
                },
            );
            m
        }
    }

    fn make_root() -> (tempfile::TempDir, PathBuf) {
        let root = tempdir().unwrap();
        let day_dir = root.path().join("2026").join("07").join("08");
        fs::create_dir_all(&day_dir).unwrap();
        let rollout = day_dir.join(format!("rollout-2026-07-08-{THREAD_ID}.jsonl"));
        fs::write(&rollout, "{\"type\":\"response_item\"}\n").unwrap();
        (root, rollout)
    }

    #[tokio::test]
    async fn returns_true_when_the_registry_rollout_exists_inside_root() {
        let (root, rollout) = make_root();
        let lookup = lookup_with(Some(rollout.to_string_lossy().into_owned()));
        let deps = CodexTranscriptDeps {
            lookup: Some(&lookup),
            sessions_root: Some(root.path().to_path_buf()),
        };
        assert_eq!(
            is_codex_transcript_present(THREAD_ID, Some(&deps)).await,
            Some(true)
        );
    }

    #[tokio::test]
    async fn returns_false_when_the_rollout_was_deleted() {
        let (root, _rollout) = make_root();
        let gone = root
            .path()
            .join("2026")
            .join("07")
            .join("08")
            .join(format!("rollout-gone-{THREAD_ID}.jsonl"));
        let lookup = lookup_with(Some(gone.to_string_lossy().into_owned()));
        let deps = CodexTranscriptDeps {
            lookup: Some(&lookup),
            sessions_root: Some(root.path().to_path_buf()),
        };
        assert_eq!(
            is_codex_transcript_present(THREAD_ID, Some(&deps)).await,
            Some(false)
        );
    }

    #[tokio::test]
    async fn returns_null_when_registry_has_no_row() {
        let (root, _rollout) = make_root();
        let lookup = |_ids: &[String]| HashMap::new();
        let deps = CodexTranscriptDeps {
            lookup: Some(&lookup),
            sessions_root: Some(root.path().to_path_buf()),
        };
        assert_eq!(
            is_codex_transcript_present(THREAD_ID, Some(&deps)).await,
            None
        );
    }

    #[tokio::test]
    async fn returns_null_when_registry_row_has_no_rollout_path() {
        let (root, _rollout) = make_root();
        let lookup = lookup_with(None);
        let deps = CodexTranscriptDeps {
            lookup: Some(&lookup),
            sessions_root: Some(root.path().to_path_buf()),
        };
        assert_eq!(
            is_codex_transcript_present(THREAD_ID, Some(&deps)).await,
            None
        );
    }

    #[tokio::test]
    async fn returns_null_when_rollout_resolves_outside_root() {
        let (root, _rollout) = make_root();
        let outside = tempdir().unwrap();
        let outside_file = outside.path().join("rollout-x.jsonl");
        fs::write(&outside_file, "x\n").unwrap();
        let lookup = lookup_with(Some(outside_file.to_string_lossy().into_owned()));
        let deps = CodexTranscriptDeps {
            lookup: Some(&lookup),
            sessions_root: Some(root.path().to_path_buf()),
        };
        assert_eq!(
            is_codex_transcript_present(THREAD_ID, Some(&deps)).await,
            None
        );
    }
}

// PORT STATUS: src/plugins/builtin/codex/transcript.ts (41 lines)
// confidence: high
// todos: 0
// notes: NEW (#424). realpath → tokio::fs::canonicalize; containment via
// notes: resolved.starts_with(canonicalized root) (the TS `resolved.startsWith(root +
// notes: sep)` — rollout files are always strictly nested, so component-based
// notes: starts_with agrees; the outside case lives in a different tempdir). Return
// notes: maps: null→None, false→Some(false), true→Some(true). lookup is an injectable
// notes: closure (defaults to thread_registry::lookup_agent_metadata, a sync one-shot
// notes: read of Codex's external state DB, same as the TS). Ports transcript.test.ts
// notes: assertion-for-assertion (5 cases).
