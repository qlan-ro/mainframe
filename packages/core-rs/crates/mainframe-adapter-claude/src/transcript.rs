//! The canonical `~/.claude/projects/<encoded>/<sessionId>.jsonl` path helper
//! plus the transcript-presence probe used by degraded-chat recovery.

use std::path::{Path, PathBuf};

use dirs::home_dir;
use mainframe_types::transcript::TranscriptLocation;
use tokio::fs;

/// `{ jsonlPath, projectDir }` — the canonical transcript path pair for a session.
pub struct SessionJsonlPath {
    pub jsonl_path: String,
    pub project_dir: String,
}

/// CLI parity: replace every char NOT in `[a-zA-Z0-9-]` with '-' (keeps dashes).
/// Also sanitizes session ids before they become a file name.
pub(crate) fn encode_project_path(project_path: &str) -> String {
    project_path
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// `~/.claude/projects` — the parent of every per-project transcript directory.
fn claude_projects_root() -> PathBuf {
    home_dir()
        .unwrap_or_default()
        .join(".claude")
        .join("projects")
}

/// Canonical `~/.claude/projects/<encoded>/<sessionId>.jsonl` path for a session.
pub fn get_session_jsonl_path(session_id: &str, project_path: &str) -> SessionJsonlPath {
    let encoded = encode_project_path(project_path);
    let project_dir = claude_projects_root().join(&encoded);
    let jsonl_path = project_dir.join(format!("{session_id}.jsonl"));
    SessionJsonlPath {
        jsonl_path: jsonl_path.to_string_lossy().to_string(),
        project_dir: project_dir.to_string_lossy().to_string(),
    }
}

/// Claude's transcript location for `session_id`: the stored `session_file_path`
/// when it exists, else the path derived from the project path, else whichever
/// project directory holds it, else `Missing`. Claude's layout is always known,
/// so this never returns `None`. The stored and derived paths both lag a
/// relocation: the CLI moves the transcript into the new cwd's project
/// directory whenever the session changes directory (`EnterWorktree`,
/// `ExitWorktree`, `/cd`) and does not tell us, so only the scan finds it.
pub async fn locate_claude_transcript(
    session_id: &str,
    project_path: &str,
    session_file_path: Option<&str>,
) -> Option<TranscriptLocation> {
    let derived = get_session_jsonl_path(session_id, project_path).jsonl_path;
    let candidates: Vec<String> = [session_file_path.map(str::to_string), Some(derived)]
        .into_iter()
        .flatten()
        .filter(|p| !p.is_empty())
        .collect();
    for candidate in candidates {
        // A readable file's `metadata` succeeds, a missing one errors — the
        // presence signal for the .jsonl transcripts.
        if fs::metadata(&candidate).await.is_ok() {
            return Some(TranscriptLocation::Present(candidate));
        }
    }
    match find_in_project_dirs(&claude_projects_root(), session_id).await {
        Some(relocated) => Some(TranscriptLocation::Present(relocated)),
        None => Some(TranscriptLocation::Missing),
    }
}

/// `<root>/*/<session_id>.jsonl`, for a transcript the CLI moved to a project
/// directory we cannot derive. Session ids are UUIDs, so any hit is this
/// session's. An id that is not a plain file name is never joined onto a path.
async fn find_in_project_dirs(root: &Path, session_id: &str) -> Option<String> {
    if session_id.is_empty()
        || !session_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return None;
    }
    let file_name = format!("{session_id}.jsonl");
    let mut entries = match fs::read_dir(root).await {
        Ok(entries) => entries,
        Err(err) => {
            tracing::debug!(%err, root = %root.display(), "claude projects dir unreadable");
            return None;
        }
    };
    loop {
        let entry = match entries.next_entry().await {
            Ok(Some(entry)) => entry,
            Ok(None) => return None,
            Err(err) => {
                tracing::warn!(%err, root = %root.display(), "claude projects dir scan failed");
                return None;
            }
        };
        let candidate = entry.path().join(&file_name);
        if fs::metadata(&candidate).await.is_ok_and(|m| m.is_file()) {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
}

/// Whether the CLI transcript for `sessionId` still exists on disk — re-expressed
/// as a single `locate_claude_transcript` probe so presence and location never
/// drift out of sync.
pub(crate) async fn is_claude_transcript_present(
    session_id: &str,
    project_path: &str,
    session_file_path: Option<&str>,
) -> bool {
    matches!(
        locate_claude_transcript(session_id, project_path, session_file_path).await,
        Some(TranscriptLocation::Present(_))
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn encode_keeps_dashes_replaces_other_metachars() {
        assert_eq!(
            encode_project_path("/Users/x/my_proj.v2"),
            "-Users-x-my-proj-v2"
        );
        // existing dashes are preserved
        assert_eq!(encode_project_path("a-b/c"), "a-b-c");
    }

    #[tokio::test]
    async fn returns_true_when_the_stored_session_file_path_exists() {
        let dir = tempfile::tempdir().unwrap();
        let existing = dir.path().join("session-1.jsonl");
        let mut f = std::fs::File::create(&existing).unwrap();
        f.write_all(b"{\"type\":\"user\"}\n").unwrap();
        assert!(
            is_claude_transcript_present(
                "session-1",
                "/nonexistent/project",
                Some(existing.to_str().unwrap()),
            )
            .await
        );
    }

    #[tokio::test]
    async fn returns_false_when_neither_stored_nor_derived_path_exists() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("gone.jsonl");
        assert!(
            !is_claude_transcript_present(
                "no-such-session",
                "/nonexistent/project",
                Some(gone.to_str().unwrap()),
            )
            .await
        );
    }

    #[tokio::test]
    async fn returns_false_with_no_stored_path_and_missing_derived_path() {
        assert!(
            !is_claude_transcript_present("no-such-session", "/nonexistent/project", None).await
        );
    }

    #[tokio::test]
    async fn locate_returns_present_at_the_stored_path_when_it_exists() {
        let dir = tempfile::tempdir().unwrap();
        let existing = dir.path().join("session-1.jsonl");
        let mut f = std::fs::File::create(&existing).unwrap();
        f.write_all(b"{\"type\":\"user\"}\n").unwrap();
        let stored = existing.to_str().unwrap();
        assert_eq!(
            locate_claude_transcript("session-1", "/nonexistent/project", Some(stored)).await,
            Some(TranscriptLocation::Present(stored.to_string()))
        );
    }

    /// `get_session_jsonl_path` always derives under the real `~/.claude/projects`
    /// tree, so exercising the fallback branch means writing there — cleaned up
    /// on drop (even on panic) so the test never leaves a stray directory behind.
    struct RemoveDirOnDrop(String);
    impl Drop for RemoveDirOnDrop {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test]
    async fn locate_falls_back_to_the_derived_path_when_the_stored_path_is_absent() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("gone.jsonl");
        let project_path = format!("mainframe-test-derived-fallback-{}", std::process::id());
        let derived = get_session_jsonl_path("session-2", &project_path);
        std::fs::create_dir_all(&derived.project_dir).unwrap();
        std::fs::File::create(&derived.jsonl_path).unwrap();
        let _cleanup = RemoveDirOnDrop(derived.project_dir.clone());

        assert_eq!(
            locate_claude_transcript("session-2", &project_path, Some(gone.to_str().unwrap()),)
                .await,
            Some(TranscriptLocation::Present(derived.jsonl_path))
        );
    }

    #[tokio::test]
    async fn scan_finds_a_transcript_relocated_to_another_project_dir() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("-repo")).unwrap();
        let worktree_dir = root.path().join("-repo--claude-worktrees-feature");
        std::fs::create_dir_all(&worktree_dir).unwrap();
        let moved = worktree_dir.join("7f0c9a52-5b1e-4d7e-9f00-3c2b1a0e9d11.jsonl");
        std::fs::File::create(&moved).unwrap();

        assert_eq!(
            find_in_project_dirs(root.path(), "7f0c9a52-5b1e-4d7e-9f00-3c2b1a0e9d11").await,
            Some(moved.to_string_lossy().to_string())
        );
    }

    #[tokio::test]
    async fn scan_returns_none_when_no_project_dir_holds_the_session() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("-repo")).unwrap();
        std::fs::File::create(root.path().join("-repo").join("other-session.jsonl")).unwrap();

        assert_eq!(find_in_project_dirs(root.path(), "session-3").await, None);
    }

    #[tokio::test]
    async fn scan_rejects_a_session_id_that_is_not_a_plain_file_name() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("-repo");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::File::create(root.path().join("escape.jsonl")).unwrap();

        assert_eq!(find_in_project_dirs(root.path(), "../escape").await, None);
        assert_eq!(find_in_project_dirs(root.path(), "").await, None);
    }

    #[tokio::test]
    async fn scan_returns_none_when_the_projects_root_is_absent() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(
            find_in_project_dirs(&root.path().join("missing"), "session-4").await,
            None
        );
    }

    #[tokio::test]
    async fn locate_returns_missing_when_neither_path_exists() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("gone.jsonl");
        assert_eq!(
            locate_claude_transcript(
                "no-such-session",
                "/nonexistent/project",
                Some(gone.to_str().unwrap()),
            )
            .await,
            Some(TranscriptLocation::Missing)
        );
    }
}
