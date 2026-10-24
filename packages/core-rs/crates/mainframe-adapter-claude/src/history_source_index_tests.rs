use super::*;
use std::sync::atomic::Ordering;

async fn file(root: &Path, name: &str, session: &str) -> PathBuf {
    let path = root.join(name);
    tokio::fs::write(&path, format!("\n{{\"sessionId\":\"{session}\"}}\n"))
        .await
        .unwrap();
    tokio::fs::canonicalize(path).await.unwrap()
}

#[tokio::test]
async fn a_restarted_index_does_not_reopen_unchanged_headers() {
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let related = file(root.path(), "legacy.jsonl", "wanted").await;
    file(root.path(), "unrelated.jsonl", "other").await;
    let first = HistorySourceIndex::new(cache.path().into());
    assert_eq!(
        first.related_files(root.path(), "wanted").await.unwrap(),
        vec![related.clone().to_string_lossy().into_owned()]
    );
    assert_eq!(first.header_reads.load(Ordering::Relaxed), 2);
    let second = HistorySourceIndex::new(cache.path().into());
    assert_eq!(
        second.related_files(root.path(), "wanted").await.unwrap(),
        vec![related.to_string_lossy().into_owned()]
    );
    assert_eq!(second.header_reads.load(Ordering::Relaxed), 0);
}

#[tokio::test]
async fn new_changed_removed_and_replaced_files_update_membership() {
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let index = HistorySourceIndex::new(cache.path().into());
    let old = file(root.path(), "old.jsonl", "other").await;
    assert!(
        index
            .related_files(root.path(), "wanted")
            .await
            .unwrap()
            .is_empty()
    );
    tokio::fs::write(&old, "{\"sessionId\":\"wanted\"}\n")
        .await
        .unwrap();
    assert_eq!(
        index
            .related_files(root.path(), "wanted")
            .await
            .unwrap()
            .len(),
        1
    );
    let new = file(root.path(), "new.jsonl", "wanted").await;
    assert_eq!(
        index
            .related_files(root.path(), "wanted")
            .await
            .unwrap()
            .len(),
        2
    );
    tokio::fs::remove_file(old).await.unwrap();
    assert_eq!(
        index.related_files(root.path(), "wanted").await.unwrap(),
        vec![new.to_string_lossy().into_owned()]
    );
}

#[tokio::test]
async fn an_index_for_another_directory_cannot_supply_membership() {
    let one = tempfile::tempdir().unwrap();
    let two = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    file(one.path(), "same.jsonl", "wanted").await;
    file(two.path(), "same.jsonl", "other").await;
    let index = HistorySourceIndex::new(cache.path().into());
    assert_eq!(
        index
            .related_files(one.path(), "wanted")
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(
        index
            .related_files(two.path(), "wanted")
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn corrupt_index_and_unwritable_cache_fall_back_to_actual_headers() {
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    file(root.path(), "related.jsonl", "wanted").await;
    let index = HistorySourceIndex::new(cache.path().into());
    index.related_files(root.path(), "wanted").await.unwrap();
    let mut entries = tokio::fs::read_dir(cache.path()).await.unwrap();
    let path = entries.next_entry().await.unwrap().unwrap().path();
    tokio::fs::write(path, "corrupt").await.unwrap();
    assert_eq!(
        index
            .related_files(root.path(), "wanted")
            .await
            .unwrap()
            .len(),
        1
    );
    let cache_file = file(root.path(), "not-a-directory", "other").await;
    let unavailable = HistorySourceIndex::new(cache_file);
    assert_eq!(
        unavailable
            .related_files(root.path(), "wanted")
            .await
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn indexed_loading_preserves_full_history_and_subagent_discovery() {
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    for (name, id) in [("wanted.jsonl", "one"), ("legacy.jsonl", "two")] {
        let entry = serde_json::json!({"sessionId":"wanted","uuid":id,"type":"assistant",
            "timestamp":"2026-10-24T00:00:00Z","message":{"id":id,"role":"assistant",
            "content":[{"type":"text","text":id}]}});
        tokio::fs::write(root.path().join(name), format!("{entry}\n"))
            .await
            .unwrap();
    }
    file(root.path(), "unrelated.jsonl", "other").await;
    let index = HistorySourceIndex::new(cache.path().into());
    let path = root.path().to_str().unwrap();
    let expected = crate::history::load_history_in_dir("wanted", path).await;
    let actual = crate::history::load_history_in_dir_with_index("wanted", path, Some(&index)).await;
    assert_eq!(actual.len(), 2);
    assert_eq!(actual, expected);
    let subagents = root.path().join("wanted/subagents");
    tokio::fs::create_dir_all(&subagents).await.unwrap();
    file(&subagents, "agent.jsonl", "wanted").await;
    let discovered = crate::history::history_discovery::discover_indexed_files_in_dir(
        "wanted",
        path,
        Some(&index),
    )
    .await;
    assert!(discovered.complete);
    assert_eq!(discovered.all_files.len(), 3);
    assert_eq!(discovered.subagent_files.len(), 1);
}

#[tokio::test]
async fn unreadable_header_evidence_disables_snapshot_fingerprinting() {
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    file(root.path(), "wanted.jsonl", "wanted").await;
    tokio::fs::write(root.path().join("unknown.jsonl"), [255, 254])
        .await
        .unwrap();
    let index = HistorySourceIndex::new(cache.path().into());
    let discovered = crate::history::history_discovery::discover_indexed_files_in_dir(
        "wanted",
        root.path().to_str().unwrap(),
        Some(&index),
    )
    .await;
    assert!(!discovered.complete);
}
