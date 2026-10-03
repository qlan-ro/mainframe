use crate::history_converters::convert_history_entry;
use serde_json::{Value, json};
use std::collections::HashSet;

#[test]
fn parent_lineage_and_end_turn_without_success_keep_original_history_visible() {
    let mut seen = HashSet::new();
    let first = json!({"type":"assistant","sessionId":"provider-session","uuid":"first-entry","parentUuid":"user","timestamp":"2026-10-03T00:00:00Z","message":{"id":"api-final","stop_reason":null,"model":"model","content":[{"type":"thinking","thinking":"work"}]}});
    let mut final_entry = first.clone();
    final_entry["uuid"] = json!("second-entry");
    final_entry["parentUuid"] = json!("first-entry");
    final_entry["message"]["stop_reason"] = json!("end_turn");
    final_entry["message"]["content"] = json!([{"type":"text","text":"🦀answer"}]);
    let a = convert_history_entry(&first, "chat", &mut seen).unwrap();
    let b = convert_history_entry(&final_entry, "chat", &mut seen).unwrap();
    assert_eq!(a.id, "api-final");
    assert_eq!(b.id, "second-entry");
    assert_eq!(
        serde_json::to_value(&b.content).unwrap(),
        json!([{"type":"text","text":"🦀answer"}])
    );
    assert_eq!(a.metadata, b.metadata);
    assert_eq!(
        b.metadata.as_ref().unwrap().get("model"),
        Some(&json!("model"))
    );
    assert!(
        !b.metadata
            .as_ref()
            .unwrap()
            .contains_key("transcriptPresentation")
    );
}

#[test]
fn captured_queued_history_never_synthesizes_a_successful_epoch() {
    let entries: Vec<Value> = include_str!("__fixtures__/queued-command-attachment.jsonl")
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    assert!(
        entries
            .iter()
            .any(|e| e["message"]["stop_reason"] == "end_turn")
    );
    assert!(
        !entries
            .iter()
            .any(|e| e["type"] == "result" && e["subtype"] == "success")
    );
    let mut seen = HashSet::new();
    let messages: Vec<_> = entries
        .iter()
        .filter_map(|e| convert_history_entry(e, "chat", &mut seen))
        .collect();
    assert!(!messages.is_empty());
    assert!(messages.iter().all(|m| {
        m.metadata
            .as_ref()
            .is_none_or(|meta| !meta.contains_key("transcriptPresentation"))
    }));
}
