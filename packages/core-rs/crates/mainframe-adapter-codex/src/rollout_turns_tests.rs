//! Parity of the streamed rollout conversion with the old whole-string one,
//! plus an opt-in large-file timing run (`--ignored`, see `bench_pr_scan`).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "Test assertions")]

use super::*;
use crate::rollout_fork::forked_child_start_line;
use fixtures::*;
use mainframe_adapter_api::pr_detection::scan_history_for_prs;
use serde_json::json;
use std::io::Cursor;

fn stream(raw: &[u8], thread: &str, capacity: usize) -> Option<Vec<ChatMessage>> {
    let reader = || BufReader::with_capacity(capacity, Cursor::new(raw.to_vec()));
    let start = forked_start(reader())?;
    convert_rollout_stream(reader(), thread, start).ok()
}

fn render(messages: &[ChatMessage]) -> Vec<serde_json::Value> {
    messages
        .iter()
        .map(|m| {
            let mut v = serde_json::to_value(m).unwrap();
            // Ids come from the conversion counter and must match; only the
            // timestamp is taken from the clock.
            v.as_object_mut().unwrap().remove("timestamp");
            v
        })
        .collect()
}

/// Old and new must agree on the messages and on the PR links scanned from them.
fn assert_parity(raw: &str) {
    let old = convert_rollout_whole_string(raw, "t");
    for capacity in [1, 7, 64, 8192, CHUNK_SIZE] {
        let new = stream(raw.as_bytes(), "t", capacity).expect("valid utf-8");
        assert_eq!(render(&new), render(&old), "capacity {capacity}");
        assert_eq!(
            format!("{:?}", scan_history_for_prs(&new)),
            format!("{:?}", scan_history_for_prs(&old)),
            "capacity {capacity}"
        );
    }
}

#[test]
fn pr_links_match_across_chunk_boundaries_order_and_dedupe() {
    let mut lines = Vec::new();
    for (i, pad) in [0usize, 5, 6, 7, 8, 9, 63, 64, 65, 1000].iter().enumerate() {
        // Same PR twice (dedupe) interleaved with distinct ones (order).
        lines.extend(pr_turn(
            &format!("a{i}"),
            &format!("ca{i}"),
            10 + i as u32,
            *pad,
        ));
        lines.extend(pr_turn(&format!("b{i}"), &format!("cb{i}"), 10, *pad));
    }
    let raw = lines.join("\n");
    assert_parity(&raw);
    let new = stream(raw.as_bytes(), "t", 7).unwrap();
    let numbers: Vec<_> = scan_history_for_prs(&new)
        .iter()
        .map(|p| p.number)
        .collect();
    assert_eq!(numbers, (10..20).collect::<Vec<_>>());
}

#[test]
fn trailing_newline_crlf_blank_lines_and_missing_final_newline() {
    let mut lines = pr_turn("t1", "c1", 5, 3);
    lines.insert(2, assistant("caf\u{e9} \u{20ac}5 \u{1f600}"));
    let body = lines.join("\r\n");
    for raw in [
        format!("{body}\r\n"),
        format!("{body}\n\n\n"),
        format!("\n{body}"),
        format!("{body}\r"),
        body.replace("\r\n", "\n"),
    ] {
        assert_parity(&raw);
    }
}

#[test]
fn turn_started_complete_and_aborted_events_match() {
    let lines = vec![
        event("turn_started", "a"),
        user("one"),
        exec("c1", "gh pr create"),
        exec_output("c1", "https://github.com/acme/repo/pull/1"),
        event("turn_complete", "a"),
        event("turn_started", "b"),
        user("two"),
        assistant("stopping"),
        exec("c2", "gh pr create"),
        exec_output("c2", "https://github.com/acme/repo/pull/2"),
        event("turn_aborted", "b"),
        event("turn_started", "c"),
        user("three"),
    ];
    let raw = lines.join("\n");
    assert_parity(&raw);
    let new = stream(raw.as_bytes(), "t", 7).unwrap();
    // The status only decides the turn grouping (it is not rendered), so a
    // link in an aborted turn must still be found.
    let numbers: Vec<_> = scan_history_for_prs(&new)
        .iter()
        .map(|p| p.number)
        .collect();
    assert_eq!(numbers, [1, 2]);
}

#[test]
fn malformed_and_unrelated_lines_are_skipped() {
    let mut lines = vec!["{not json".to_owned(), String::new(), "[]".to_owned()];
    lines.extend(pr_turn("t1", "c1", 5, 0));
    lines.push(r#"{"type":"response_item","payload":"oops"}"#.to_owned());
    lines.push(r#"{"type":"event_msg"}"#.to_owned());
    lines.push(line("turn_context", json!({"model": "m"})));
    lines.push(line("event_msg", json!({"type": "token_count"})));
    lines.extend(pr_turn("t2", "c2", 6, 0));
    lines.push("{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_sta".to_owned());
    assert_parity(&lines.join("\n"));
}

#[test]
fn empty_file_and_blank_only_file() {
    for raw in ["", "\n", "\n\n\n", "   "] {
        assert_parity(raw);
        assert!(stream(raw.as_bytes(), "t", 8).unwrap().is_empty());
    }
}

#[test]
fn unfinished_turn_and_events_without_turn_ids() {
    let mut lines = vec![
        user("orphan"),
        exec("c0", "gh pr create"),
        exec_output("c0", "https://github.com/acme/repo/pull/1"),
    ];
    lines.push(event("task_started", "open"));
    lines.push(user("hi"));
    lines.push(assistant("working"));
    lines.push(event("task_complete", "other"));
    lines.push(exec("c1", "gh pr create"));
    lines.push(exec_output("c1", "https://github.com/acme/repo/pull/2"));
    assert_parity(&lines.join("\n"));
}

#[test]
fn forked_child_skips_the_parent_prefix_like_before() {
    let meta = line(
        "session_meta",
        json!({"id": "child", "session_id": "parent", "forked_from_id": "parent",
               "agent_path": "/root/c"}),
    );
    let handoff = line(
        "response_item",
        json!({"type": "agent_message", "author": "/root", "recipient": "/root/c"}),
    );
    let mut lines = vec![meta.clone()];
    lines.extend(pr_turn("p1", "pc1", 90, 0));
    lines.push(handoff);
    lines.extend(pr_turn("c1", "cc1", 91, 0));
    let raw = lines.join("\n");
    assert_parity(&raw);
    let new = stream(raw.as_bytes(), "t", 16).unwrap();
    let numbers: Vec<_> = scan_history_for_prs(&new)
        .iter()
        .map(|p| p.number)
        .collect();
    assert_eq!(numbers, [91]);
    // A fork without its handoff keeps every line, as before.
    let mut no_handoff = vec![meta];
    no_handoff.extend(pr_turn("p1", "pc1", 90, 0));
    assert_parity(&no_handoff.join("\n"));
    let all: Vec<&str> = no_handoff.iter().map(String::as_str).collect();
    assert_eq!(forked_child_start_line(&all), None);
}

#[test]
fn non_fork_meta_and_meta_without_agent_path() {
    let plain = line("session_meta", json!({"id": "a", "session_id": "a"}));
    let fork_no_path = line("session_meta", json!({"id": "a", "forked_from_id": "z"}));
    for meta in [plain, fork_no_path] {
        let mut lines = vec![meta];
        lines.extend(pr_turn("t", "c", 3, 0));
        assert_parity(&lines.join("\n"));
    }
}

#[test]
fn invalid_utf8_anywhere_reads_as_none_like_read_to_string() {
    let mut raw = pr_turn("t", "c", 3, 0).join("\n").into_bytes();
    raw.extend_from_slice(b"\n\xff\xfe\n");
    raw.extend(pr_turn("t2", "c2", 4, 0).join("\n").into_bytes());
    assert!(String::from_utf8(raw.clone()).is_err());
    assert!(stream(&raw, "t", 8).is_none());
    assert!(stream(&raw, "t", CHUNK_SIZE).is_none());
}

#[tokio::test]
async fn read_rollout_history_streams_a_file_inside_the_sessions_root() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("rollout-t.jsonl");
    std::fs::write(&path, pr_turn("t1", "c1", 8, 2).join("\n")).unwrap();
    let deps = RolloutReaderDeps {
        sessions_root: Some(root.path().to_path_buf()),
    };
    let messages = read_rollout_history(path.to_str().unwrap(), "t", Some(&deps))
        .await
        .expect("messages");
    assert_eq!(scan_history_for_prs(&messages).len(), 1);
    std::fs::write(&path, "").unwrap();
    assert!(
        read_rollout_history(path.to_str().unwrap(), "t", Some(&deps))
            .await
            .is_none()
    );
}

#[test]
fn convert_rollout_steer_keeps_turn_membership_and_delivery_identity() {
    let raw = r#"
{"type":"event_msg","payload":{"type":"task_started","turn_id":"first"}}
{"type":"event_msg","payload":{"type":"user_message","message":"initial","client_id":"initial-id"}}
{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"initial"}]}}
{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"working"}]}}
{"type":"event_msg","payload":{"type":"user_message","message":"steer","client_id":"steer-id"}}
{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"done"}]}}
{"type":"event_msg","payload":{"type":"task_complete","turn_id":"first"}}
{"type":"event_msg","payload":{"type":"task_started","turn_id":"second"}}
{"type":"event_msg","payload":{"type":"user_message","message":"next","client_id":"next-id"}}
"#;
    assert_parity(raw);
    let messages = stream(raw.as_bytes(), "thread", 16).unwrap();
    let users: Vec<_> = messages
        .iter()
        .filter_map(|message| message.metadata.as_ref())
        .filter(|metadata| metadata.contains_key("providerInputUuid"))
        .collect();
    assert_eq!(users.len(), 3);
    assert_eq!(users[1]["providerInputUuid"], "steer-id");
    assert_eq!(users[1]["steered"], true);
    assert!(!users[2].contains_key("steered"));
}

#[path = "rollout_turns_bench.rs"]
mod bench;
#[path = "rollout_turns_fixtures.rs"]
mod fixtures;
