//! Ported from `packages/core/src/plugins/builtin/claude/transcript.ts`.
//!
//! The canonical `~/.claude/projects/<encoded>/<sessionId>.jsonl` path helper
//! (moved here out of `history.ts` to dedup) plus the transcript-presence probe
//! used by degraded-chat recovery.

use dirs::home_dir;
use mainframe_types::transcript::TranscriptLocation;
use tokio::fs;

/// `{ jsonlPath, projectDir }` — the canonical transcript path pair for a session.
pub struct SessionJsonlPath {
    pub jsonl_path: String,
    pub project_dir: String,
}

/// CLI parity: replace every char NOT in `[a-zA-Z0-9-]` with '-' (keeps dashes).
fn encode_project_path(project_path: &str) -> String {
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

/// Canonical `~/.claude/projects/<encoded>/<sessionId>.jsonl` path for a session.
pub fn get_session_jsonl_path(session_id: &str, project_path: &str) -> SessionJsonlPath {
    let encoded = encode_project_path(project_path);
    let project_dir = home_dir()
        .unwrap_or_default()
        .join(".claude")
        .join("projects")
        .join(&encoded);
    let jsonl_path = project_dir.join(format!("{session_id}.jsonl"));
    SessionJsonlPath {
        jsonl_path: jsonl_path.to_string_lossy().to_string(),
        project_dir: project_dir.to_string_lossy().to_string(),
    }
}

/// Claude's transcript location for `session_id`: the stored `session_file_path`
/// when it exists, else the path derived from the project path, else `Missing`.
/// Claude's layout is always known, so this never returns `None`. Both
/// candidates are needed: the stored path can lag a relocation (the CLI's own
/// worktree tool moves the transcript without telling us), and the derived one
/// misses a transcript that never lived at the canonical location.
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
        // TS `access(candidate, constants.R_OK)`; a readable file's `metadata`
        // succeeds, a missing one errors — same signal for the .jsonl transcripts.
        if fs::metadata(&candidate).await.is_ok() {
            return Some(TranscriptLocation::Present(candidate));
        }
    }
    Some(TranscriptLocation::Missing)
}

/// Whether the CLI transcript for `sessionId` still exists on disk — re-expressed
/// as a single `locate_claude_transcript` probe so presence and location never
/// drift out of sync.
pub async fn is_claude_transcript_present(
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

    // Translated assertion-for-assertion from claude/__tests__/transcript.test.ts.

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

// PORT STATUS: src/plugins/builtin/claude/transcript.ts (34 lines)
// confidence: high
// todos: 0
// notes: Main catch-up (#424). getSessionJsonlPath moved here from history.ts
// notes: (history.rs now imports it — its private session_jsonl_path/encode_project_path
// notes: are removed and the encode_project_path test relocated here).
// notes: is_claude_transcript_present maps `access(_, R_OK)` to tokio::fs::metadata
// notes: (same present/missing signal for readable .jsonl files). Returns bool (never
// notes: null) — the adapter wraps it as Ok(Some(bool)). transcript.test.ts translated.
