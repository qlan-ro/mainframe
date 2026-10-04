use super::*;
use std::time::Duration;

fn msg(id: &str) -> ChatMessage {
    serde_json::from_value(serde_json::json!({
        "id": id, "chatId": "c1", "type": "user",
        "timestamp": "2026-10-02T00:00:00Z", "content": []
    }))
    .unwrap()
}

async fn source_file(dir: &tempfile::TempDir, name: &str, contents: &str) -> PathBuf {
    let path = dir.path().join(name);
    tokio::fs::write(&path, contents).await.unwrap();
    path
}

// ── fingerprint ───────────────────────────────────────────────────────────

#[tokio::test]
async fn fingerprint_is_none_for_no_sources() {
    assert!(HistoryFingerprint::compute(&[]).await.is_none());
}

#[tokio::test]
async fn fingerprint_is_none_when_a_source_is_missing() {
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("nope.jsonl");
    assert!(HistoryFingerprint::compute(&[missing]).await.is_none());
}

#[tokio::test]
async fn identical_sources_fingerprint_equal() {
    let dir = tempfile::tempdir().unwrap();
    let path = source_file(&dir, "a.jsonl", "line one").await;
    let fp1 = HistoryFingerprint::compute(std::slice::from_ref(&path))
        .await
        .unwrap();
    let fp2 = HistoryFingerprint::compute(&[path]).await.unwrap();
    assert_eq!(fp1, fp2);
}

#[tokio::test]
async fn a_changed_source_fingerprints_differently() {
    let dir = tempfile::tempdir().unwrap();
    let path = source_file(&dir, "a.jsonl", "line one").await;
    let before = HistoryFingerprint::compute(std::slice::from_ref(&path))
        .await
        .unwrap();
    // A different length always moves the fingerprint even on filesystems
    // with coarse mtime resolution.
    tokio::fs::write(&path, "line one, extended").await.unwrap();
    let after = HistoryFingerprint::compute(&[path]).await.unwrap();
    assert_ne!(before, after);
}

#[tokio::test]
async fn source_order_does_not_affect_the_fingerprint() {
    let dir = tempfile::tempdir().unwrap();
    let a = source_file(&dir, "a.jsonl", "a").await;
    let b = source_file(&dir, "b.jsonl", "b").await;
    let forward = HistoryFingerprint::compute(&[a.clone(), b.clone()])
        .await
        .unwrap();
    let backward = HistoryFingerprint::compute(&[b, a]).await.unwrap();
    assert_eq!(forward, backward);
}

// ── read/write (hit, miss, corrupt, mismatch) ────────────────────────────

#[tokio::test]
async fn a_chat_with_no_snapshot_file_is_a_miss() {
    let dir = tempfile::tempdir().unwrap();
    let cache = HistorySnapshotCache::new(dir.path().to_path_buf());
    let fp = HistoryFingerprint::compute(&[source_file(&dir, "a.jsonl", "x").await])
        .await
        .unwrap();
    assert!(cache.read("missing-chat", &fp).await.is_none());
}

#[tokio::test]
async fn a_written_snapshot_is_a_hit_under_the_same_fingerprint() {
    let dir = tempfile::tempdir().unwrap();
    let cache = HistorySnapshotCache::new(dir.path().to_path_buf());
    let fp = HistoryFingerprint::compute(&[source_file(&dir, "a.jsonl", "x").await])
        .await
        .unwrap();
    let messages = vec![msg("m1"), msg("m2")];
    cache
        .write("c1", fp.clone(), messages.clone())
        .await
        .unwrap();
    assert_eq!(cache.read("c1", &fp).await, Some(messages));
}

#[tokio::test]
async fn a_fingerprint_mismatch_is_a_miss() {
    let dir = tempfile::tempdir().unwrap();
    let cache = HistorySnapshotCache::new(dir.path().to_path_buf());
    let source = source_file(&dir, "a.jsonl", "x").await;
    let written_fp = HistoryFingerprint::compute(std::slice::from_ref(&source))
        .await
        .unwrap();
    cache
        .write("c1", written_fp, vec![msg("m1")])
        .await
        .unwrap();

    tokio::fs::write(&source, "x, but changed").await.unwrap();
    let fresh_fp = HistoryFingerprint::compute(&[source]).await.unwrap();
    assert!(cache.read("c1", &fresh_fp).await.is_none());
}

#[tokio::test]
async fn a_corrupt_snapshot_file_is_a_miss_not_a_panic() {
    let dir = tempfile::tempdir().unwrap();
    let cache = HistorySnapshotCache::new(dir.path().to_path_buf());
    let fp = HistoryFingerprint::compute(&[source_file(&dir, "a.jsonl", "x").await])
        .await
        .unwrap();
    tokio::fs::write(dir.path().join("c1.json"), b"not json at all")
        .await
        .unwrap();
    assert!(cache.read("c1", &fp).await.is_none());
}

#[tokio::test]
async fn write_in_background_eventually_lands_a_hit() {
    let dir = tempfile::tempdir().unwrap();
    let cache = Arc::new(HistorySnapshotCache::new(dir.path().to_path_buf()));
    let fp = HistoryFingerprint::compute(&[source_file(&dir, "a.jsonl", "x").await])
        .await
        .unwrap();
    cache.write_in_background("c1".to_string(), fp.clone(), vec![msg("m1")]);

    let mut hit = None;
    for _ in 0..50 {
        if let Some(messages) = cache.read("c1", &fp).await {
            hit = Some(messages);
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(hit, Some(vec![msg("m1")]));
}

// ── pruning ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn pruning_keeps_only_the_newest_snapshots_by_mtime() {
    let dir = tempfile::tempdir().unwrap();
    let cache = HistorySnapshotCache::with_max_snapshots(dir.path().to_path_buf(), 2);
    let fp = HistoryFingerprint::compute(&[source_file(&dir, "a.jsonl", "x").await])
        .await
        .unwrap();

    for id in ["oldest", "middle", "newest"] {
        cache.write(id, fp.clone(), vec![msg(id)]).await.unwrap();
        // Nudge mtimes apart — both macOS (APFS) and Linux (ext4) CI runners
        // give sub-millisecond mtime resolution, so this stays fast and safe.
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    assert!(cache.read("oldest", &fp).await.is_none());
    assert_eq!(cache.read("middle", &fp).await, Some(vec![msg("middle")]));
    assert_eq!(cache.read("newest", &fp).await, Some(vec![msg("newest")]));
}
