use serde_json::json;

use super::*;

fn meta_line(
    id: &str,
    session_id: &str,
    forked_from_id: Option<&str>,
    agent_path: Option<&str>,
) -> String {
    let mut payload = json!({ "id": id, "session_id": session_id });
    if let Some(f) = forked_from_id {
        payload["forked_from_id"] = json!(f);
    }
    if let Some(a) = agent_path {
        payload["agent_path"] = json!(a);
    }
    json!({ "type": "session_meta", "payload": payload }).to_string()
}

fn handoff_line(recipient: &str) -> String {
    json!({
        "type": "response_item",
        "payload": { "type": "agent_message", "author": "/root", "recipient": recipient }
    })
    .to_string()
}

#[test]
fn non_forked_meta_processes_every_line() {
    let meta = meta_line("t1", "t1", None, None);
    let lines = vec![meta.as_str(), "{}"];
    assert_eq!(forked_child_start_line(&lines), None);
}

#[test]
fn forked_meta_skips_up_to_the_new_task_handoff() {
    let meta = meta_line("child", "parent", Some("parent"), Some("/root/child"));
    let handoff = handoff_line("/root/child");
    let lines = vec![
        meta.as_str(),
        "leaked parent text",
        handoff.as_str(),
        "real child text",
    ];
    assert_eq!(forked_child_start_line(&lines), Some(3));
}

#[test]
fn forked_meta_with_no_handoff_falls_back_to_processing_everything() {
    let meta = meta_line("child", "parent", Some("parent"), Some("/root/child"));
    let lines = vec![meta.as_str(), "no handoff here"];
    assert_eq!(forked_child_start_line(&lines), None);
}

#[test]
fn forked_meta_detected_via_mismatched_id_without_forked_from_id() {
    let meta = meta_line("child", "parent", None, Some("/root/child"));
    let handoff = handoff_line("/root/child");
    let lines = vec![meta.as_str(), "leaked", handoff.as_str()];
    assert_eq!(forked_child_start_line(&lines), Some(3));
}

#[test]
fn forked_meta_with_no_agent_path_falls_back_to_processing_everything() {
    let meta = meta_line("child", "parent", Some("parent"), None);
    let lines = vec![meta.as_str(), "leaked"];
    assert_eq!(forked_child_start_line(&lines), None);
}
