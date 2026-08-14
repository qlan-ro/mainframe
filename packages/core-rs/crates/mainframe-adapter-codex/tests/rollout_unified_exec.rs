//! Reconstructing the modern Codex "unified exec" tool from the rollout JSONL
//! (todo #339 task 14): a `custom_tool_call` `name:"exec"` whose `input` is a
//! JS snippet wrapping `tools.exec_command({...})`, paired with a
//! `custom_tool_call_output` whose `output` is an array of `input_text`
//! blocks rather than the plain string every other tool call kind uses.
//!
//! This file compiles today and is expected to fail on behavior: neither
//! `handle_custom_tool_call` (which only recognizes `name == "apply_patch"`)
//! nor `RolloutPayload.output` (typed `Option<String>`) understands this
//! shape yet. Task 16 teaches `rollout_reconstruct`/`rollout_reader` both;
//! until then every array-shaped `custom_tool_call_output` line fails
//! `serde_json::from_str::<RolloutLine>` and is silently skipped, so these
//! assertions are expected to fail rather than panic. Do not weaken them to
//! make the file pass early.
#![allow(clippy::unwrap_used, clippy::expect_used)]

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
    let path = root.path().join(format!("rollout-mf339-{thread_id}.jsonl"));
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

/// The real wrapper the modern Codex shell tool writes to the rollout: a JS
/// snippet calling `tools.exec_command({...})`, where the object literal is
/// exactly what `handle_custom_tool_call` must brace-match and parse.
fn unified_exec_call_line(call_id: &str, cmd: &serde_json::Value, workdir: &str) -> String {
    let inner = json!({"cmd": cmd, "workdir": workdir}).to_string();
    let input = format!("const r = await tools.exec_command({inner}); text(r.output);");
    json!({
        "type": "response_item",
        "payload": {
            "type": "custom_tool_call",
            "status": "completed",
            "call_id": call_id,
            "name": "exec",
            "input": input,
        }
    })
    .to_string()
}

/// Array-shaped `output`, as the real rollout carries it — not the plain
/// string every other `custom_tool_call_output` payload uses.
fn unified_exec_output_line(call_id: &str, texts: &[&str]) -> String {
    let output: Vec<serde_json::Value> = texts
        .iter()
        .map(|t| json!({"type": "input_text", "text": t}))
        .collect();
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

fn custom_tool_call_line(call_id: &str, name: &str, input: &str) -> String {
    json!({
        "type": "response_item",
        "payload": {
            "type": "custom_tool_call",
            "status": "completed",
            "call_id": call_id,
            "name": name,
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

#[tokio::test]
async fn unified_exec_reconstructs_command_execution_with_the_pr_url() {
    let root = tempfile::tempdir().unwrap();
    let lines = vec![
        unified_exec_call_line(
            "call_exec_1",
            &json!("gh pr create --title x"),
            "/tmp/mf339",
        ),
        unified_exec_output_line(
            "call_exec_1",
            &[
                "Script completed\nOutput:\n",
                "https://github.com/acme/repo/pull/7\n",
            ],
        ),
    ];
    let path = write_rollout(&root, "thread_unified_1", &lines);
    let items = read_rollout_items(&path, Some("thread_unified_1"), Some(&deps(&root))).await;

    assert_eq!(
        items.len(),
        1,
        "expected one CommandExecution, got {items:?}"
    );
    let ThreadItem::CommandExecution(c) = &items[0] else {
        panic!("expected CommandExecution, got {:?}", items[0])
    };
    assert_eq!(c.id, "call_exec_1");
    assert_eq!(c.command, "gh pr create --title x");
    assert!(
        c.aggregated_output
            .contains("https://github.com/acme/repo/pull/7"),
        "expected the PR URL in the aggregated output, got {:?}",
        c.aggregated_output
    );
}

#[tokio::test]
async fn unified_exec_cmd_given_as_an_array_is_joined_with_spaces() {
    let root = tempfile::tempdir().unwrap();
    let lines = vec![
        unified_exec_call_line(
            "call_exec_2",
            &json!(["gh", "pr", "create", "--title", "x"]),
            "/tmp/mf339",
        ),
        unified_exec_output_line("call_exec_2", &["done\n"]),
    ];
    let path = write_rollout(&root, "thread_unified_2", &lines);
    let items = read_rollout_items(&path, Some("thread_unified_2"), Some(&deps(&root))).await;

    assert_eq!(
        items.len(),
        1,
        "expected one CommandExecution, got {items:?}"
    );
    let ThreadItem::CommandExecution(c) = &items[0] else {
        panic!("expected CommandExecution, got {:?}", items[0])
    };
    assert_eq!(c.command, "gh pr create --title x");
}

#[tokio::test]
async fn unified_exec_malformed_input_is_skipped_without_panicking_and_neighbours_still_parse() {
    let root = tempfile::tempdir().unwrap();
    let lines = vec![
        message_line("assistant", "before the bad call"),
        custom_tool_call_line(
            "call_exec_bad",
            "exec",
            "not a parseable exec_command wrapper",
        ),
        unified_exec_output_line("call_exec_bad", &["should never surface\n"]),
        message_line("assistant", "after the bad call"),
    ];
    let path = write_rollout(&root, "thread_unified_3", &lines);
    let items = read_rollout_items(&path, Some("thread_unified_3"), Some(&deps(&root))).await;

    assert!(
        items
            .iter()
            .all(|i| !matches!(i, ThreadItem::CommandExecution(_))),
        "malformed unified-exec input must not produce a CommandExecution, got {items:?}"
    );
    assert!(matches!(&items[0], ThreadItem::AgentMessage(m) if m.text == "before the bad call"));
    assert!(
        matches!(items.last(), Some(ThreadItem::AgentMessage(m)) if m.text == "after the bad call")
    );
}

#[tokio::test]
async fn apply_patch_output_stays_string_shaped_after_widening_the_output_field() {
    let root = tempfile::tempdir().unwrap();
    let patch = "*** Begin Patch\n*** Update File: src/regression_guard.rs\n@@\n-old\n+new\n*** End Patch\n";
    let lines = vec![
        custom_tool_call_line("call_patch_regression", "apply_patch", patch),
        custom_tool_call_output_line(
            "call_patch_regression",
            "Exit code: 0\nOutput:\nSuccess. Updated the following files:\nM src/regression_guard.rs\n",
        ),
    ];
    let path = write_rollout(&root, "thread_unified_4", &lines);
    let items = read_rollout_items(&path, Some("thread_unified_4"), Some(&deps(&root))).await;

    assert_eq!(items.len(), 1, "expected one FileChange, got {items:?}");
    let ThreadItem::FileChange(f) = &items[0] else {
        panic!("expected FileChange, got {:?}", items[0])
    };
    assert_eq!(f.status, "completed");
    assert!(matches!(f.changes[0].kind, PatchChangeKind::Update { .. }));
}
