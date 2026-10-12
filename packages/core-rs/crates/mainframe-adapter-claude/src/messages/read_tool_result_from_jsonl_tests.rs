use super::*;
use std::io::Write;

fn fixture() -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("s.jsonl");
    let lines = [
        serde_json::json!({
            "type": "user",
            "message": { "content": [{ "type": "tool_result", "tool_use_id": "tu_1", "content": "FULL CONTENT ONE" }] }
        })
        .to_string(),
        serde_json::json!({
            "type": "user",
            "message": { "content": [{
                "type": "tool_result",
                "tool_use_id": "tu_2",
                "content": [
                    { "type": "text", "text": "PART A" },
                    { "type": "text", "text": "PART B" }
                ]
            }] }
        })
        .to_string(),
    ];
    std::fs::write(&file, lines.join("\n") + "\n").unwrap();
    (dir, file.to_string_lossy().to_string())
}

#[tokio::test]
async fn returns_full_string_content_by_id() {
    let (_dir, f) = fixture();
    assert_eq!(
        read_tool_result_from_jsonl(&f, "tu_1").await,
        Some("FULL CONTENT ONE".to_string())
    );
}

#[tokio::test]
async fn flattens_array_content_blocks() {
    let (_dir, f) = fixture();
    let r = read_tool_result_from_jsonl(&f, "tu_2").await.unwrap();
    assert!(r.contains("PART A"));
    assert!(r.contains("PART B"));
}

#[tokio::test]
async fn returns_null_when_id_absent() {
    let (_dir, f) = fixture();
    assert_eq!(read_tool_result_from_jsonl(&f, "nope").await, None);
}

#[tokio::test]
async fn returns_null_when_file_missing() {
    assert_eq!(
        read_tool_result_from_jsonl("/no/such/file.jsonl", "tu_1").await,
        None
    );
}

#[tokio::test]
async fn tolerates_partial_trailing_line() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("s.jsonl");
    let mut f = std::fs::File::create(&file).unwrap();
    let good = serde_json::json!({
        "type": "user",
        "message": { "content": [{ "type": "tool_result", "tool_use_id": "tu_9", "content": "OK" }] }
    })
    .to_string();
    write!(f, "{good}\n{{\"type\":\"user\",\"mess").unwrap();
    assert_eq!(
        read_tool_result_from_jsonl(&file.to_string_lossy(), "tu_9").await,
        Some("OK".to_string())
    );
}
