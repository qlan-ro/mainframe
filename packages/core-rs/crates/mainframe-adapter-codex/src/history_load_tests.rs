use serde_json::json;

use super::{collect_child_thread_ids, truncate_at_turn_cap};
use crate::types::{ThreadItem, ThreadReadTurn};

fn items(v: serde_json::Value) -> Vec<ThreadItem> {
    serde_json::from_value(v).expect("items parse")
}

fn turn(id: &str) -> ThreadReadTurn {
    ThreadReadTurn {
        id: id.to_string(),
        status: "completed".to_string(),
        items: Vec::new(),
        timing: Default::default(),
    }
}

// ---- truncate_at_turn_cap ----

#[test]
fn no_cap_keeps_every_turn() {
    let turns = vec![turn("t1"), turn("t2")];
    assert_eq!(truncate_at_turn_cap(turns.clone(), None, "thread-1"), turns);
}

#[test]
fn cap_at_the_first_turn_drops_everything_after_it() {
    let turns = vec![turn("t1"), turn("t2"), turn("t3")];
    let capped = truncate_at_turn_cap(turns, Some("t1"), "thread-1");
    assert_eq!(
        capped.into_iter().map(|t| t.id).collect::<Vec<_>>(),
        vec!["t1".to_string()]
    );
}

#[test]
fn cap_at_the_last_turn_keeps_everything() {
    let turns = vec![turn("t1"), turn("t2")];
    let capped = truncate_at_turn_cap(turns, Some("t2"), "thread-1");
    assert_eq!(
        capped.into_iter().map(|t| t.id).collect::<Vec<_>>(),
        vec!["t1".to_string(), "t2".to_string()]
    );
}

#[test]
fn an_unknown_cap_id_keeps_every_turn() {
    let turns = vec![turn("t1"), turn("t2")];
    let capped = truncate_at_turn_cap(turns.clone(), Some("does-not-exist"), "thread-1");
    assert_eq!(capped, turns);
}

#[test]
fn collects_the_child_thread_id_from_a_started_activity_ping() {
    let all = items(json!([
        { "id": "s1", "type": "subAgentActivity", "kind": "started", "agentThreadId": "child-1", "agentPath": "/root/child" },
    ]));
    assert_eq!(collect_child_thread_ids(&all), vec!["child-1".to_string()]);
}

#[test]
fn collects_the_child_thread_id_from_a_waits_receiver_list() {
    let all = items(json!([
        { "id": "w1", "type": "collabAgentToolCall", "tool": "wait", "status": "completed", "receiverThreadIds": ["child-2"] },
    ]));
    assert_eq!(collect_child_thread_ids(&all), vec!["child-2".to_string()]);
}

#[test]
fn dedupes_a_child_named_by_both_routes() {
    let all = items(json!([
        { "id": "s1", "type": "subAgentActivity", "kind": "started", "agentThreadId": "child-3", "agentPath": "/root/child" },
        { "id": "w1", "type": "collabAgentToolCall", "tool": "wait", "status": "completed", "receiverThreadIds": ["child-3"] },
    ]));
    assert_eq!(collect_child_thread_ids(&all), vec!["child-3".to_string()]);
}

#[test]
fn ignores_a_non_wait_collab_tool_call_and_a_started_ping_with_no_activity() {
    let all = items(json!([
        { "id": "sp1", "type": "collabAgentToolCall", "tool": "spawnAgent", "status": "completed", "receiverThreadIds": ["child-4"] },
    ]));
    assert_eq!(collect_child_thread_ids(&all), Vec::<String>::new());
}
