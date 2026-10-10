use std::collections::HashMap;
use std::path::PathBuf;

use mainframe_types::transcript::TranscriptLocation;

use crate::thread_registry::{AgentMetadata, lookup_agent_metadata};

/// Registry lookup — injectable for tests; defaults to Codex's state DB.
/// `Send + Sync` so the `Adapter::locate_transcript` override yields a `Send`
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

/// Codex's transcript location for `thread_id`. Returns `None` (cannot
/// determine — don't flag) when the state DB has no row, the row carries no
/// rollout path, or the path escapes `~/.codex/sessions` (untrusted input,
/// mirrors rollout-reader.rs containment). `Some(Missing)` when the rollout
/// file was deleted, `Some(Present(path))` when it is present and contained.
pub async fn locate_codex_transcript(
    thread_id: &str,
    deps: Option<&CodexTranscriptDeps<'_>>,
) -> Option<TranscriptLocation> {
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
        Err(_) => return Some(TranscriptLocation::Missing),
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
    Some(TranscriptLocation::Present(
        resolved.to_string_lossy().into_owned(),
    ))
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
    async fn locate_returns_none_when_registry_row_has_no_rollout_path() {
        let (root, _rollout) = make_root();
        let lookup = lookup_with(None);
        let deps = CodexTranscriptDeps {
            lookup: Some(&lookup),
            sessions_root: Some(root.path().to_path_buf()),
        };
        assert_eq!(locate_codex_transcript(THREAD_ID, Some(&deps)).await, None);
    }

    #[tokio::test]
    async fn locate_returns_present_when_the_rollout_exists_inside_root() {
        let (root, rollout) = make_root();
        let lookup = lookup_with(Some(rollout.to_string_lossy().into_owned()));
        let deps = CodexTranscriptDeps {
            lookup: Some(&lookup),
            sessions_root: Some(root.path().to_path_buf()),
        };
        let resolved = tokio::fs::canonicalize(&rollout).await.unwrap();
        assert_eq!(
            locate_codex_transcript(THREAD_ID, Some(&deps)).await,
            Some(TranscriptLocation::Present(
                resolved.to_string_lossy().into_owned()
            ))
        );
    }

    #[tokio::test]
    async fn locate_returns_missing_when_the_rollout_was_deleted() {
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
            locate_codex_transcript(THREAD_ID, Some(&deps)).await,
            Some(TranscriptLocation::Missing)
        );
    }

    #[tokio::test]
    async fn locate_returns_none_when_registry_has_no_row() {
        let (root, _rollout) = make_root();
        let lookup = |_ids: &[String]| HashMap::new();
        let deps = CodexTranscriptDeps {
            lookup: Some(&lookup),
            sessions_root: Some(root.path().to_path_buf()),
        };
        assert_eq!(locate_codex_transcript(THREAD_ID, Some(&deps)).await, None);
    }

    #[tokio::test]
    async fn locate_returns_none_when_rollout_resolves_outside_root() {
        let (root, _rollout) = make_root();
        let outside = tempdir().unwrap();
        let outside_file = outside.path().join("rollout-x.jsonl");
        fs::write(&outside_file, "x\n").unwrap();
        let lookup = lookup_with(Some(outside_file.to_string_lossy().into_owned()));
        let deps = CodexTranscriptDeps {
            lookup: Some(&lookup),
            sessions_root: Some(root.path().to_path_buf()),
        };
        assert_eq!(locate_codex_transcript(THREAD_ID, Some(&deps)).await, None);
    }
}
