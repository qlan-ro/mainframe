//! `eligible`: whether a window read may start, which `will_page_history`
//! reports before the warm-up decides to leave the open to the window.
use super::*;
use fixture::discovered;

/// A sparse main transcript of exactly `len` bytes.
async fn transcript(dir: &tempfile::TempDir, name: &str, len: u64) -> String {
    let path = dir.path().join(name);
    tokio::fs::File::create(&path)
        .await
        .unwrap()
        .set_len(len)
        .await
        .unwrap();
    path.to_string_lossy().into_owned()
}

#[tokio::test]
async fn a_transcript_one_byte_short_of_the_floor_is_not_paged() {
    let dir = tempfile::tempdir().unwrap();
    let path = transcript(&dir, "main.jsonl", MIN_FILE - 1).await;

    assert!(!eligible(&discovered(&path, &[])).await);
}

#[tokio::test]
async fn a_transcript_at_the_floor_is_paged() {
    let dir = tempfile::tempdir().unwrap();
    let path = transcript(&dir, "main.jsonl", MIN_FILE).await;

    assert!(eligible(&discovered(&path, &[])).await);
}

#[tokio::test]
async fn a_session_with_several_parent_files_is_not_paged() {
    let dir = tempfile::tempdir().unwrap();
    let path = transcript(&dir, "main.jsonl", MIN_FILE).await;
    let resumed = transcript(&dir, "resumed.jsonl", 10).await;

    assert!(!eligible(&discovered(&path, &[&resumed])).await);
}

#[tokio::test]
async fn an_incomplete_discovery_or_a_missing_file_is_not_paged() {
    let dir = tempfile::tempdir().unwrap();
    let path = transcript(&dir, "main.jsonl", MIN_FILE).await;
    let mut incomplete = discovered(&path, &[]);
    incomplete.complete = false;
    let missing = dir.path().join("gone.jsonl").to_string_lossy().into_owned();

    assert!(!eligible(&incomplete).await);
    assert!(!eligible(&discovered(&missing, &[])).await);
}
