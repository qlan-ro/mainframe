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
