use super::*;
use std::io::Write;

#[test]
fn encode_keeps_dashes_replaces_other_metachars() {
    assert_eq!(
        mainframe_types::paths::encode_claude_project_path("/Users/x/my_proj.v2"),
        "-Users-x-my-proj-v2"
    );
    // existing dashes are preserved
    assert_eq!(
        mainframe_types::paths::encode_claude_project_path("a-b/c"),
        "a-b-c"
    );
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
    assert!(!is_claude_transcript_present("no-such-session", "/nonexistent/project", None).await);
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
        if let Err(error) = std::fs::remove_dir_all(&self.0) {
            tracing::warn!(%error, "best-effort operation failed");
        }
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
        locate_claude_transcript("session-2", &project_path, Some(gone.to_str().unwrap()),).await,
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
