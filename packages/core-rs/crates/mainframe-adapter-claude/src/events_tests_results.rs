use super::*;
#[test]
fn user_event_entry_uuid_becomes_the_tool_result_vendor_id() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({
            "type": "user",
            "uuid": "entry-uuid-2",
            "message": { "role": "user", "content": [
                { "type": "tool_result", "tool_use_id": "tu_1", "content": "done" }
            ] }
        }),
    );
    assert_eq!(
        sink.r().last_tool_result_vendor_id,
        Some("entry-uuid-2".to_string())
    );
}

#[test]
fn skips_cli_message_when_replay() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "user", "isReplay": true, "uuid": "some-uuid", "message": { "role": "user", "content": [ { "type": "text", "text": "Hello from user" } ] } }),
    );
    assert!(sink.r().cli_messages.is_empty());
    assert_eq!(sink.r().queued, vec!["some-uuid".to_string()]);
}

#[test]
fn surfaces_visible_in_transcript_only() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "user", "isVisibleInTranscriptOnly": true, "message": { "role": "user", "content": "Unknown skill: /unknown" } }),
    );
    assert_eq!(
        sink.r().cli_messages,
        vec!["Unknown skill: /unknown".to_string()]
    );
}

#[test]
fn assistant_event_without_a_uuid_leaves_vendor_id_absent() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({
            "type": "assistant",
            "message": { "model": "claude", "content": [
                { "type": "text", "text": "hi" }
            ] }
        }),
    );
    assert_eq!(
        sink.r().last_message_metadata.as_ref().unwrap().vendor_id,
        None
    );
}

#[test]
fn skips_cli_message_when_meta_local_command() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "user", "isMeta": true, "message": { "role": "user", "content": [ { "type": "text", "text": "<local-command-caveat>skill content</local-command-caveat>" } ] } }),
    );
    assert!(sink.r().cli_messages.is_empty());
}

#[test]
fn skips_when_content_begins_with_compaction_preamble() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "user", "message": { "role": "user", "content": "This session is being continued from a previous conversation that ran out of context. Summary: ..." } }),
    );
    assert!(sink.r().cli_messages.is_empty());
}

#[test]
fn top_level_result_fires_on_result() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "result", "subtype": "success", "total_cost_usd": 0.002, "usage": { "input_tokens": 200, "output_tokens": 80 } }),
    );
    assert_eq!(sink.r().results, 1);
}

#[test]
fn skips_string_content_flagged_is_compact_summary() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "user", "isCompactSummary": true, "isVisibleInTranscriptOnly": true, "message": { "role": "user", "content": "This session is being continued from a previous conversation that ran out of context. Summary: ..." } }),
    );
    assert!(sink.r().cli_messages.is_empty());
}

#[test]
fn assistant_event_entry_uuid_becomes_the_message_metadata_vendor_id() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({
            "type": "assistant",
            "uuid": "entry-uuid-1",
            "message": { "model": "claude", "content": [
                { "type": "text", "text": "hi" }
            ] }
        }),
    );
    assert_eq!(
        sink.r().last_message_metadata.as_ref().unwrap().vendor_id,
        Some("entry-uuid-1".to_string())
    );
}

#[test]
fn surfaces_cli_text_when_not_replay_not_meta() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "user", "message": { "role": "user", "content": [ { "type": "text", "text": "Unknown command: /inisights. Did you mean /insights?" } ] } }),
    );
    assert_eq!(
        sink.r().cli_messages,
        vec!["Unknown command: /inisights. Did you mean /insights?".to_string()]
    );
}
