#![allow(clippy::unwrap_used, clippy::expect_used)]
use mainframe_adapter_codex::history::convert_thread_items;
use mainframe_adapter_codex::rollout_reader::{RolloutReaderDeps, read_rollout_items};
use serde_json::json;
use std::collections::HashMap;

#[tokio::test]
async fn command_metadata_legacy_rollout_does_not_infer_actions_or_textual_duration() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("rollout-legacy.jsonl");
    let records = [
        json!({"type":"response_item","payload":{"type":"function_call","call_id":"cmd","name":"exec_command","arguments":"{\"cmd\":\"cat a\"}"}}),
        json!({"type":"response_item","payload":{"type":"function_call_output","call_id":"cmd","output":"Wall time: 1.234 seconds\nProcess exited with code 0\nFinal output:\nhello"}}),
    ];
    std::fs::write(
        &path,
        records
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join("\n"),
    )
    .unwrap();
    let deps = RolloutReaderDeps {
        sessions_root: Some(dir.path().to_path_buf()),
    };
    let items = read_rollout_items(path.to_str().unwrap(), None, Some(&deps)).await;
    assert_eq!(items.len(), 1);
    let messages = convert_thread_items(&items, "chat", &HashMap::new(), &HashMap::new());
    let value = serde_json::to_value(&messages[0].content[0]).unwrap();
    assert_eq!(value["name"], "Bash");
    assert_eq!(value["input"], json!({"command":"cat a"}));
    assert!(value.get("commandExecution").is_none());
}
