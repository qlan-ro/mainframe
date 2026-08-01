//! `read_rollout_items` reconstructing sub-agent `apply_patch` (custom_tool_call)
//! and MCP (`function_call` w/ `namespace: "mcp__*"`) records on reload (B5),
//! plus the existing message/reasoning/exec_command paths staying correct when
//! interleaved with the new record types in the same rollout file.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use common::capture_path;
use mainframe_adapter_codex::item_types::{PatchChangeKind, ThreadItem};
use mainframe_adapter_codex::rollout_reader::{RolloutReaderDeps, read_rollout_items};
use serde_json::json;
use tempfile::TempDir;

fn deps(root: &TempDir) -> RolloutReaderDeps {
    RolloutReaderDeps {
        sessions_root: Some(root.path().to_path_buf()),
    }
}

fn write_rollout(root: &TempDir, thread_id: &str, lines: &[String]) -> String {
    let path = root.path().join(format!("rollout-{thread_id}.jsonl"));
    std::fs::write(&path, lines.join("\n")).unwrap();
    path.to_string_lossy().to_string()
}

fn message_line(role: &str, text: &str) -> String {
    json!({
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": role,
            "content": [{"type": "output_text", "text": text}],
        }
    })
    .to_string()
}

fn reasoning_line(text: &str) -> String {
    json!({
        "type": "response_item",
        "payload": {
            "type": "reasoning",
            "summary": [{"type": "summary_text", "text": text}],
        }
    })
    .to_string()
}

fn custom_tool_call_line(call_id: &str, input: &str) -> String {
    json!({
        "type": "response_item",
        "payload": {
            "type": "custom_tool_call",
            "status": "completed",
            "call_id": call_id,
            "name": "apply_patch",
            "input": input,
        }
    })
    .to_string()
}

fn custom_tool_call_output_line(call_id: &str, output: &str) -> String {
    json!({
        "type": "response_item",
        "payload": {
            "type": "custom_tool_call_output",
            "call_id": call_id,
            "output": output,
        }
    })
    .to_string()
}

fn function_call_line(
    call_id: &str,
    name: &str,
    namespace: Option<&str>,
    arguments: &str,
) -> String {
    let mut payload = json!({
        "type": "function_call",
        "id": format!("fc_{call_id}"),
        "name": name,
        "arguments": arguments,
        "call_id": call_id,
    });
    if let Some(ns) = namespace {
        payload["namespace"] = json!(ns);
    }
    json!({"type": "response_item", "payload": payload}).to_string()
}

fn function_call_output_line(call_id: &str, output: &str) -> String {
    json!({
        "type": "response_item",
        "payload": {
            "type": "function_call_output",
            "call_id": call_id,
            "output": output,
        }
    })
    .to_string()
}

#[tokio::test]
async fn apply_patch_update_reconstructs_file_change() {
    let root = tempfile::tempdir().unwrap();
    let patch = "*** Begin Patch\n*** Update File: src/synthetic_widget.rs\n@@\n-old line\n+new line\n*** End Patch\n";
    let lines = vec![
        custom_tool_call_line("call_patch_1", patch),
        custom_tool_call_output_line(
            "call_patch_1",
            "Exit code: 0\nWall time: 0 seconds\nOutput:\nSuccess. Updated the following files:\nM src/synthetic_widget.rs\n",
        ),
    ];
    let path = write_rollout(&root, "thread_patch_1", &lines);
    let items = read_rollout_items(&path, Some("thread_patch_1"), Some(&deps(&root))).await;

    assert_eq!(items.len(), 1);
    let ThreadItem::FileChange(f) = &items[0] else {
        panic!("expected FileChange, got {:?}", items[0])
    };
    assert_eq!(f.id, "call_patch_1");
    assert_eq!(f.status, "completed");
    assert_eq!(f.changes.len(), 1);
    assert_eq!(f.changes[0].path, "src/synthetic_widget.rs");
    assert!(matches!(f.changes[0].kind, PatchChangeKind::Update { .. }));
    assert!(f.changes[0].diff.contains("+new line"));
}

#[tokio::test]
async fn apply_patch_multi_file_add_and_delete() {
    let root = tempfile::tempdir().unwrap();
    let patch = "*** Begin Patch\n*** Add File: src/new_module.rs\n+pub fn hello() {}\n*** Delete File: src/old_module.rs\n-pub fn bye() {}\n*** End Patch\n";
    let lines = vec![
        custom_tool_call_line("call_patch_2", patch),
        custom_tool_call_output_line(
            "call_patch_2",
            "Exit code: 0\nOutput:\nSuccess. Updated the following files:\nA src/new_module.rs\nD src/old_module.rs\n",
        ),
    ];
    let path = write_rollout(&root, "thread_patch_2", &lines);
    let items = read_rollout_items(&path, Some("thread_patch_2"), Some(&deps(&root))).await;

    assert_eq!(items.len(), 1);
    let ThreadItem::FileChange(f) = &items[0] else {
        panic!("expected FileChange, got {:?}", items[0])
    };
    assert_eq!(f.changes.len(), 2);
    assert_eq!(f.changes[0].path, "src/new_module.rs");
    assert!(matches!(f.changes[0].kind, PatchChangeKind::Add));
    assert!(f.changes[0].diff.contains("+pub fn hello() {}"));
    assert_eq!(f.changes[1].path, "src/old_module.rs");
    assert!(matches!(f.changes[1].kind, PatchChangeKind::Delete));
    assert!(f.changes[1].diff.contains("-pub fn bye() {}"));
}

#[tokio::test]
async fn apply_patch_failure_marks_file_change_errored() {
    let root = tempfile::tempdir().unwrap();
    let patch = "*** Begin Patch\n*** Update File: src/broken.rs\n@@\n-a\n+b\n*** End Patch\n";
    let lines = vec![
        custom_tool_call_line("call_patch_3", patch),
        custom_tool_call_output_line(
            "call_patch_3",
            "Exit code: 1\nOutput:\nError: could not apply patch\n",
        ),
    ];
    let path = write_rollout(&root, "thread_patch_3", &lines);
    let items = read_rollout_items(&path, Some("thread_patch_3"), Some(&deps(&root))).await;

    assert_eq!(items.len(), 1);
    let ThreadItem::FileChange(f) = &items[0] else {
        panic!("expected FileChange, got {:?}", items[0])
    };
    assert_eq!(f.status, "failed");
}

#[tokio::test]
async fn mcp_function_call_reconstructs_mcp_tool_call() {
    let root = tempfile::tempdir().unwrap();
    let args = json!({"query": "synthetic lookup", "limit": 3}).to_string();
    let lines = vec![
        function_call_line("call_mcp_1", "lookup_thing", Some("mcp__testserver"), &args),
        function_call_output_line("call_mcp_1", "synthetic result text"),
    ];
    let path = write_rollout(&root, "thread_mcp_1", &lines);
    let items = read_rollout_items(&path, Some("thread_mcp_1"), Some(&deps(&root))).await;

    assert_eq!(items.len(), 1);
    let ThreadItem::McpToolCall(m) = &items[0] else {
        panic!("expected McpToolCall, got {:?}", items[0])
    };
    assert_eq!(m.id, "call_mcp_1");
    assert_eq!(m.server.as_deref(), Some("testserver"));
    assert_eq!(m.tool, "lookup_thing");
    assert_eq!(
        m.arguments.get("query").and_then(|v| v.as_str()),
        Some("synthetic lookup")
    );
    assert_eq!(m.arguments.get("limit").and_then(|v| v.as_i64()), Some(3));
    let result = m.result.as_ref().expect("mcp call should have a result");
    assert_eq!(result.content.as_str(), Some("synthetic result text"));
}

#[tokio::test]
async fn mcp_arguments_fallback_to_raw_string_on_parse_failure() {
    let root = tempfile::tempdir().unwrap();
    let lines = vec![
        function_call_line(
            "call_mcp_2",
            "lookup_thing",
            Some("mcp__testserver"),
            "not valid json{{",
        ),
        function_call_output_line("call_mcp_2", "ok"),
    ];
    let path = write_rollout(&root, "thread_mcp_2", &lines);
    let items = read_rollout_items(&path, Some("thread_mcp_2"), Some(&deps(&root))).await;

    assert_eq!(items.len(), 1);
    let ThreadItem::McpToolCall(m) = &items[0] else {
        panic!("expected McpToolCall, got {:?}", items[0])
    };
    assert_eq!(
        m.arguments.get("arguments").and_then(|v| v.as_str()),
        Some("not valid json{{")
    );
}

#[tokio::test]
async fn non_mcp_function_calls_are_not_reconstructed() {
    let root = tempfile::tempdir().unwrap();
    let lines = vec![
        function_call_line("call_plan_1", "update_plan", None, "{}"),
        function_call_output_line("call_plan_1", "ok"),
        function_call_line("call_collab_1", "spawnAgent", Some("collaboration"), "{}"),
        function_call_output_line("call_collab_1", "ok"),
    ];
    let path = write_rollout(&root, "thread_ignore_1", &lines);
    let items = read_rollout_items(&path, Some("thread_ignore_1"), Some(&deps(&root))).await;

    assert!(items.is_empty());
}

#[tokio::test]
async fn interleaved_record_kinds_reconstruct_without_cross_contamination() {
    let root = tempfile::tempdir().unwrap();
    let patch =
        "*** Begin Patch\n*** Update File: src/interleaved.rs\n@@\n-old\n+new\n*** End Patch\n";
    let mcp_args = json!({"topic": "synthetic"}).to_string();
    let exec_args = json!({"cmd": "echo hi"}).to_string();
    let lines = vec![
        message_line("assistant", "starting work"),
        reasoning_line("thinking it through"),
        custom_tool_call_line("call_x_1", patch),
        function_call_line("call_x_2", "exec_command", None, &exec_args),
        function_call_line("call_x_3", "lookup", Some("mcp__docs"), &mcp_args),
        custom_tool_call_output_line(
            "call_x_1",
            "Exit code: 0\nOutput:\nSuccess. Updated the following files:\nM src/interleaved.rs\n",
        ),
        function_call_output_line("call_x_2", "Process exited with code 0\nOutput:\nhi\n"),
        function_call_output_line("call_x_3", "docs result"),
        message_line("assistant", "done"),
    ];
    let path = write_rollout(&root, "thread_combo_1", &lines);
    let items = read_rollout_items(&path, Some("thread_combo_1"), Some(&deps(&root))).await;

    assert_eq!(items.len(), 6);
    assert!(matches!(&items[0], ThreadItem::AgentMessage(m) if m.text == "starting work"));
    assert!(matches!(items[1], ThreadItem::Reasoning(_)));
    match &items[2] {
        ThreadItem::FileChange(f) => assert_eq!(f.id, "call_x_1"),
        other => panic!("expected FileChange, got {other:?}"),
    }
    match &items[3] {
        ThreadItem::CommandExecution(c) => {
            assert_eq!(c.id, "call_x_2");
            assert_eq!(c.command, "echo hi");
        }
        other => panic!("expected CommandExecution, got {other:?}"),
    }
    match &items[4] {
        ThreadItem::McpToolCall(m) => {
            assert_eq!(m.id, "call_x_3");
            assert_eq!(m.server.as_deref(), Some("docs"));
        }
        other => panic!("expected McpToolCall, got {other:?}"),
    }
    assert!(matches!(&items[5], ThreadItem::AgentMessage(m) if m.text == "done"));
}

const FORK_CHILD_ID: &str = "019fafe0-42b0-7703-91ae-1900bf8f1805";

fn session_meta_line(id: &str, session_id: &str, forked_from_id: Option<&str>) -> String {
    let mut payload = json!({ "id": id, "session_id": session_id, "agent_path": "/root/child" });
    if let Some(f) = forked_from_id {
        payload["forked_from_id"] = json!(f);
    }
    json!({ "type": "session_meta", "payload": payload }).to_string()
}

/// Todo #247 QA defect: `fork_turns: "all"` seeds a spawned child's rollout
/// with a copy of the parent's own history, so before the fix the parent's
/// commentary ("I'm delegating...") rides along into the nested sub-agent
/// card. Fixture derived from a real captured child rollout (see
/// `tests/fixtures/collab-child-rollout-fork-0.144.3.jsonl`).
#[tokio::test]
async fn forked_child_rollout_drops_the_parent_prefix_before_the_new_task_handoff() {
    let root = tempfile::tempdir().unwrap();
    let raw = std::fs::read_to_string(capture_path("collab-child-rollout-fork-0.144.3.jsonl"))
        .expect("read fixture");
    let lines: Vec<String> = raw.lines().map(str::to_string).collect();
    let path = write_rollout(&root, FORK_CHILD_ID, &lines);
    let items = read_rollout_items(&path, Some(FORK_CHILD_ID), Some(&deps(&root))).await;

    assert_eq!(
        items.len(),
        1,
        "expected only the child's own answer, got {items:?}"
    );
    match &items[0] {
        ThreadItem::AgentMessage(m) => assert_eq!(m.text, "4. Confirmed: 2 + 2 = 4."),
        other => panic!("expected AgentMessage, got {other:?}"),
    }
}

#[tokio::test]
async fn forked_rollout_with_no_handoff_marker_falls_back_to_processing_everything() {
    let root = tempfile::tempdir().unwrap();
    let lines = vec![
        session_meta_line("thread_fork_2", "thread_parent_2", Some("thread_parent_2")),
        message_line("assistant", "parent commentary, no handoff ever arrives"),
        message_line("assistant", "child's real answer"),
    ];
    let path = write_rollout(&root, "thread_fork_2", &lines);
    let items = read_rollout_items(&path, Some("thread_fork_2"), Some(&deps(&root))).await;

    assert_eq!(items.len(), 2, "expected no lines dropped, got {items:?}");
    assert!(
        matches!(&items[0], ThreadItem::AgentMessage(m) if m.text.contains("parent commentary"))
    );
}

#[tokio::test]
async fn non_forked_rollout_with_a_session_meta_line_is_unaffected() {
    let root = tempfile::tempdir().unwrap();
    let lines = vec![
        session_meta_line("thread_plain_1", "thread_plain_1", None),
        message_line("assistant", "ordinary reply"),
    ];
    let path = write_rollout(&root, "thread_plain_1", &lines);
    let items = read_rollout_items(&path, Some("thread_plain_1"), Some(&deps(&root))).await;

    assert_eq!(items.len(), 1);
    assert!(matches!(&items[0], ThreadItem::AgentMessage(m) if m.text == "ordinary reply"));
}
