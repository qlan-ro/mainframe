use super::*;

fn msg(id: &str) -> ChatMessage {
    serde_json::from_value(serde_json::json!({
        "id": id, "chatId": "c1", "type": "user",
        "timestamp": "2026-10-02T00:00:00Z", "content": []
    }))
    .unwrap()
}

async fn fingerprint(dir: &tempfile::TempDir, contents: &str) -> HistoryFingerprint {
    let path = dir.path().join("a.jsonl");
    tokio::fs::write(&path, contents).await.unwrap();
    HistoryFingerprint::compute(&[path]).await.unwrap()
}

#[tokio::test]
async fn the_peek_reads_the_fingerprint_a_snapshot_was_written_with() {
    let dir = tempfile::tempdir().unwrap();
    let cache = HistorySnapshotCache::new(dir.path().join("cache"));
    let written = fingerprint(&dir, "x").await;
    cache
        .write("c1", written.clone(), vec![msg("m1"), msg("m2")])
        .await
        .unwrap();

    assert_eq!(cache.peek_fingerprint("c1").await, Some(written));
    assert_eq!(cache.peek_fingerprint("missing").await, None);
}

#[tokio::test]
async fn the_peek_stops_before_the_messages() {
    let dir = tempfile::tempdir().unwrap();
    let cache = HistorySnapshotCache::new(dir.path().join("cache"));
    let written = fingerprint(&dir, "x").await;
    cache
        .write("c1", written.clone(), vec![msg("m1")])
        .await
        .unwrap();
    // Everything after the fingerprint replaced with bytes no JSON parser
    // accepts: a peek that read on would fail.
    let path = cache.snapshot_path("c1");
    let text = tokio::fs::read_to_string(&path).await.unwrap();
    let cut = text.find(",\"messages\"").unwrap();
    let broken = format!("{}\u{1}\u{2} not json", &text[..cut]);
    tokio::fs::write(&path, broken).await.unwrap();

    assert_eq!(cache.peek_fingerprint("c1").await, Some(written));
}

#[tokio::test]
async fn a_corrupt_or_foreign_file_has_no_fingerprint() {
    let dir = tempfile::tempdir().unwrap();
    let cache = HistorySnapshotCache::new(dir.path().join("cache"));
    tokio::fs::create_dir_all(dir.path().join("cache"))
        .await
        .unwrap();
    tokio::fs::write(cache.snapshot_path("c1"), b"not json")
        .await
        .unwrap();
    tokio::fs::write(
        cache.snapshot_path("c2"),
        br#"{"messages":[],"fingerprint":{}}"#,
    )
    .await
    .unwrap();

    assert_eq!(cache.peek_fingerprint("c1").await, None);
    assert_eq!(cache.peek_fingerprint("c2").await, None);
}
