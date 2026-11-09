use super::*;

const URL: &str = "https://claude.ai/artifact/V1LAdjrXoKC7jVLpHnV1D2";

fn tool_result(content: &str, is_error: bool, parent: Option<&str>) -> serde_json::Value {
    let mut event = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": [
            { "type": "tool_result", "tool_use_id": "toolu_artifact", "content": content, "is_error": is_error }
        ] }
    });
    if let Some(parent) = parent {
        event["parent_tool_use_id"] = serde_json::json!(parent);
    }
    event
}

#[test]
fn a_publish_in_the_session_is_reported() {
    let s = session();
    let sink = RecordingSink::default();
    let result = format!("Updated the Artifact at {URL} (Version 2, version id 1-a) with a.json");
    feed(&s, &sink, tool_result(&result, false, None));
    assert_eq!(sink.r().artifacts_published, vec![URL]);
    assert_eq!(sink.r().tool_results, 1);
}

#[test]
fn a_publish_by_a_subagent_is_reported_too() {
    let s = session();
    let sink = RecordingSink::default();
    let result = format!("Created a new Artifact at {URL} (version 1) from the Artifact type x.");
    feed(
        &s,
        &sink,
        tool_result(&result, false, Some("toolu_parent_agent")),
    );
    assert_eq!(sink.r().artifacts_published, vec![URL]);
    assert_eq!(sink.r().subagent.len(), 1);
}

#[test]
fn a_failed_publish_or_a_read_is_not() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        tool_result(&format!("Updated the Artifact at {URL}"), true, None),
    );
    feed(
        &s,
        &sink,
        tool_result(&format!("Read \"x\" from {URL}"), false, None),
    );
    assert!(sink.r().artifacts_published.is_empty());
}
