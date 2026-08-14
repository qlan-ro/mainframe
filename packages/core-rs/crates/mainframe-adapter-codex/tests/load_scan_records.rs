//! `CodexSession::load_scan_records` — the cold-load PR-detection scan source
//! for Codex (todo #339 task 15). It must source its records from the rollout
//! JSONL, not `thread/read` (which never returns `commandExecution` items on
//! codex-cli 0.147.0 — see the plan's Established facts table), and it must
//! never spawn a real `codex app-server` on the happy path.
//!
//! This file does not compile until task 17 introduces `CodexScanDeps` and
//! `CodexSession::set_scan_deps` — the production entry points
//! (`lookup_agent_metadata`, `read_rollout_items(.., None)`) hardcode `None`
//! deps and enforce containment under the real `~/.codex/sessions`, so there
//! is no way to test this offline without that seam. That is the intended
//! red phase; do not weaken these assertions to make the file build early.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use mainframe_adapter_api::AdapterSession;
use mainframe_adapter_codex::rollout_reader::RolloutReaderDeps;
use mainframe_adapter_codex::{CodexScanDeps, CodexSession};
use mainframe_runtime::ResolvedPath;
use mainframe_types::adapter::SessionOptions;
use mainframe_types::chat::{ChatMessageType, MessageContent, MessageContentNode};
use serde_json::json;
use tempfile::TempDir;

fn options(thread_id: Option<&str>) -> SessionOptions {
    SessionOptions {
        project_path: "/tmp/mf339-project".to_string(),
        chat_id: thread_id.map(str::to_string),
        mainframe_chat_id: "chat-mf339".to_string(),
    }
}

/// A `ResolvedPath` that resolves no real binary, so `load_history`'s
/// `spawn_temp_app_server` fallback can never reach a real `codex` — pinned
/// in both cases so a happy-path regression can never spawn one either.
fn unreachable_path() -> ResolvedPath {
    ResolvedPath::from_value("/nonexistent-mf339")
}

fn write_rollout(root: &TempDir, thread_id: &str, lines: &[String]) -> String {
    let path = root.path().join(format!("rollout-mf339-{thread_id}.jsonl"));
    std::fs::write(&path, lines.join("\n")).unwrap();
    path.to_string_lossy().to_string()
}

fn unified_exec_call_line(call_id: &str, cmd: &str, workdir: &str) -> String {
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

#[tokio::test]
async fn load_scan_records_reconstructs_a_pr_create_pair_from_the_rollout() {
    let root = tempfile::tempdir().unwrap();
    let thread_id = "thread-mf339-1";
    let lines = vec![
        unified_exec_call_line("call_exec_1", "gh pr create --title x", "/tmp/mf339"),
        unified_exec_output_line(
            "call_exec_1",
            &[
                "Script completed\nOutput:\n",
                "https://github.com/acme/repo/pull/7\n",
            ],
        ),
    ];
    let rollout_path = write_rollout(&root, thread_id, &lines);

    let (_db_dir, registry) =
        common::temp_registry(&[(thread_id, None, None, Some(rollout_path.as_str()))]);

    let session = CodexSession::new(options(Some(thread_id)), None, unreachable_path());
    session.set_scan_deps(CodexScanDeps {
        registry,
        rollout: RolloutReaderDeps {
            sessions_root: Some(root.path().to_path_buf()),
        },
    });

    let history = session
        .load_scan_records()
        .await
        .expect("load_scan_records should not error");

    let tool_use_msg = history
        .iter()
        .find(|m| m.r#type == ChatMessageType::Assistant)
        .unwrap_or_else(|| panic!("expected an Assistant message, got {history:?}"));
    let has_bash_create = tool_use_msg.content.iter().any(|c| {
        matches!(
            c,
            MessageContent::Node(MessageContentNode::ToolUse { name, input, .. })
                if name == "Bash"
                    && input.get("command").and_then(|v| v.as_str())
                        == Some("gh pr create --title x")
        )
    });
    assert!(
        has_bash_create,
        "expected a Bash tool_use for the PR-create command, got {tool_use_msg:?}"
    );

    let tool_result_msg = history
        .iter()
        .find(|m| m.r#type == ChatMessageType::ToolResult)
        .unwrap_or_else(|| panic!("expected a ToolResult message, got {history:?}"));
    let has_pr_url = tool_result_msg.content.iter().any(|c| {
        matches!(
            c,
            MessageContent::Node(MessageContentNode::ToolResult { content, .. })
                if content.contains("https://github.com/acme/repo/pull/7")
        )
    });
    assert!(
        has_pr_url,
        "expected the tool result to carry the PR URL, got {tool_result_msg:?}"
    );
}

#[tokio::test]
async fn load_scan_records_falls_back_to_load_history_without_a_registry_row() {
    let root = tempfile::tempdir().unwrap();
    let thread_id = "thread-mf339-missing";
    let (_db_dir, registry) = common::temp_registry(&[]);

    let session = CodexSession::new(options(Some(thread_id)), None, unreachable_path());
    session.set_scan_deps(CodexScanDeps {
        registry,
        rollout: RolloutReaderDeps {
            sessions_root: Some(root.path().to_path_buf()),
        },
    });

    let history = session
        .load_scan_records()
        .await
        .expect("falling back to load_history must not error even with no registry row");
    assert!(
        history.is_empty(),
        "expected an empty vec (no rollout, and load_history can't reach a real codex), got {history:?}"
    );
}
