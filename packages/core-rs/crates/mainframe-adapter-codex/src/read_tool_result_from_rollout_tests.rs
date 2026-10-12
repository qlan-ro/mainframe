use super::*;
use std::io::Write;

fn rollout(lines: &[serde_json::Value]) -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("rollout.jsonl");
    let mut file = std::fs::File::create(&path).unwrap();
    for line in lines {
        writeln!(file, "{line}").unwrap();
    }
    (dir, path.to_string_lossy().into_owned())
}

fn output_record(kind: &str, call_id: &str, output: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "type": "response_item",
        "payload": { "type": kind, "call_id": call_id, "output": output }
    })
}

#[tokio::test]
async fn returns_a_shell_output_with_the_exit_header_stripped() {
    let (_dir, path) = rollout(&[
        serde_json::json!({ "type": "session_meta", "payload": { "id": "s1" } }),
        output_record(
            "function_call_output",
            "call_1",
            serde_json::json!("Chunk ID: 1\nProcess exited with code 0\nOutput:\nFULL OUTPUT"),
        ),
    ]);
    assert_eq!(
        read_tool_result_from_rollout(&path, "call_1")
            .await
            .as_deref(),
        Some("FULL OUTPUT")
    );
}

#[tokio::test]
async fn joins_block_outputs_and_matches_custom_tool_call_outputs() {
    let (_dir, path) = rollout(&[output_record(
        "custom_tool_call_output",
        "call_2",
        serde_json::json!([{ "type": "output_text", "text": "PART A" }, { "type": "output_text", "text": "PART B" }]),
    )]);
    assert_eq!(
        read_tool_result_from_rollout(&path, "call_2")
            .await
            .as_deref(),
        Some("PART APART B")
    );
}

#[tokio::test]
async fn ignores_other_records_and_tolerates_a_torn_trailing_line() {
    let (_dir, path) = rollout(&[
        serde_json::json!({ "type": "response_item", "payload": { "type": "function_call", "call_id": "call_3", "arguments": "{}" } }),
        output_record("function_call_output", "call_9", serde_json::json!("other")),
    ]);
    std::fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(b"{\"type\": \"response_item\", \"payload\": {\"type\": \"function_call_out")
        .unwrap();
    assert_eq!(read_tool_result_from_rollout(&path, "call_3").await, None);
    assert_eq!(
        read_tool_result_from_rollout(&path, "call_9")
            .await
            .as_deref(),
        Some("other")
    );
}

#[tokio::test]
async fn a_missing_file_reads_as_no_result() {
    assert_eq!(
        read_tool_result_from_rollout("/nonexistent/rollout.jsonl", "call_1").await,
        None
    );
}
