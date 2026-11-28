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

#[tokio::test]
async fn a_snapshot_is_written_fingerprint_first() {
    let dir = tempfile::tempdir().unwrap();
    let cache = HistorySnapshotCache::new(dir.path().join("cache"));
    let written = fingerprint(&dir, "x").await;
    cache.write("c1", written, vec![msg("m1")]).await.unwrap();

    let text = tokio::fs::read_to_string(cache.snapshot_path("c1"))
        .await
        .unwrap();
    assert!(text.starts_with("{\"fingerprint\":"), "{}", &text[..40]);
}

/// A snapshot file, fingerprint first or after the other fields, with an `adapter_state` of
/// `state_bytes` bytes.
fn snapshot_text(
    fingerprint: &HistoryFingerprint,
    state_bytes: usize,
    fingerprint_first: bool,
) -> String {
    let fingerprint = serde_json::to_string(fingerprint).unwrap();
    let state = serde_json::to_string(&"s".repeat(state_bytes)).unwrap();
    if fingerprint_first {
        format!(
            r#"{{"fingerprint":{fingerprint},"adapter_state":{state},"dependencies":[],"messages":[]}}"#
        )
    } else {
        format!(
            r#"{{"adapter_state":{state},"dependencies":[],"fingerprint":{fingerprint},"messages":[]}}"#
        )
    }
}

#[tokio::test]
async fn a_head_over_the_read_limit_is_read_when_the_fingerprint_leads_and_stale_when_it_trails() {
    let dir = tempfile::tempdir().unwrap();
    let cache = HistorySnapshotCache::new(dir.path().join("cache"));
    tokio::fs::create_dir_all(dir.path().join("cache"))
        .await
        .unwrap();
    let written = fingerprint(&dir, "x").await;
    let big = 2 << 20;
    tokio::fs::write(
        cache.snapshot_path("new"),
        snapshot_text(&written, big, true),
    )
    .await
    .unwrap();
    // The order files had before the fingerprint led: past the limit it reads
    // as stale, which costs one parse and a rewrite, never a wrong hit.
    tokio::fs::write(
        cache.snapshot_path("old"),
        snapshot_text(&written, big, false),
    )
    .await
    .unwrap();
    tokio::fs::write(
        cache.snapshot_path("old-small"),
        snapshot_text(&written, 16, false),
    )
    .await
    .unwrap();

    assert_eq!(cache.peek_fingerprint("new").await, Some(written.clone()));
    assert_eq!(cache.peek_fingerprint("old").await, None);
    assert_eq!(cache.peek_fingerprint("old-small").await, Some(written));
}
