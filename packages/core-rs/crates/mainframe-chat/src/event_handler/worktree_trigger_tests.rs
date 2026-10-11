//! `on_worktree_trigger` fires exactly once per tool-result batch when a
//! completed, non-error tool call created a git worktree (which calls count is
//! `worktree_tool`'s table), and
//! `on_transcript_moved` fires when one of Claude's worktree tools moved the
//! session (and with it the transcript) to another directory.

use super::tests::Harness;
use super::*;
use crate::test_support::{FakeDeps, test_chat};

/// A sink over a working "chat-wt" whose stored row carries a CLI session,
/// so a transcript move has something to look up. The fake lists no
/// worktrees, so a rescan only registers in `list_calls`.
fn sink() -> (Arc<dyn SessionSink>, Arc<FakeDeps>) {
    let mut chat = test_chat("chat-wt");
    chat.process_state = Some(Some(ProcessState::Working));
    chat.vendor_session_id = Some("sess-wt".to_string());
    let deps = FakeDeps::arc();
    *deps.adapters.transcript_present.lock().unwrap() = Some(true);
    let h = Harness::with_deps(deps, Arc::new(Mutex::new(ActiveChat::new(chat, None))));
    (h.sink("chat-wt"), h.deps)
}

/// Runs the tasks the sink spawned (a rescan, a transcript refresh) to completion.
async fn settle() {
    for _ in 0..4 {
        tokio::task::yield_now().await;
    }
}

/// How many worktree rescans ran.
fn rescans(deps: &FakeDeps) -> usize {
    deps.list_calls()
}

/// How many transcript refreshes looked the session up.
fn transcript_lookups(deps: &FakeDeps) -> usize {
    deps.adapters.locate_calls.lock().unwrap().len()
}

fn tool_use(id: &str, name: &str, command: Option<&str>) -> MessageContent {
    let mut input = HashMap::new();
    if let Some(command) = command {
        input.insert(
            "command".to_string(),
            serde_json::Value::String(command.to_string()),
        );
    }
    MessageContent::Node(MessageContentNode::ToolUse {
        timing: None,
        command_execution: None,
        id: id.to_string(),
        name: name.to_string(),
        input,
        parent_tool_use_id: None,
    })
}

fn tool_result(tool_use_id: &str, is_error: bool) -> MessageContent {
    MessageContent::Node(MessageContentNode::ToolResult {
        tool_use_id: tool_use_id.to_string(),
        content: "done".to_string(),
        is_error,
        structured_patch: None,
        original_file: None,
        modified_file: None,
        images: Vec::new(),
        parent_tool_use_id: None,
    })
}

#[tokio::test]
async fn a_bash_worktree_add_command_triggers_one_rescan_after_a_successful_result() {
    let (sink, deps) = sink();

    sink.on_message(
        vec![tool_use(
            "tu-1",
            "Bash",
            Some("git worktree add ../wt -b feat/x"),
        )],
        None,
    );
    sink.on_tool_result(vec![tool_result("tu-1", false)], None);

    settle().await;
    assert_eq!(rescans(&deps), 1);
}

#[tokio::test]
async fn a_read_only_worktree_command_never_triggers_a_rescan() {
    let (sink, deps) = sink();

    // Read-only worktree commands must not rescan: that would offer this chat
    // the worktrees other sessions created since its last scan.
    sink.on_message(
        vec![tool_use("tu-1", "Bash", Some("git worktree list"))],
        None,
    );
    sink.on_tool_result(vec![tool_result("tu-1", false)], None);

    settle().await;
    assert_eq!(rescans(&deps), 0);
}

#[tokio::test]
async fn a_failed_worktree_command_result_does_not_trigger_a_rescan() {
    let (sink, deps) = sink();

    sink.on_message(
        vec![tool_use("tu-1", "Bash", Some("git worktree add ../wt"))],
        None,
    );
    sink.on_tool_result(vec![tool_result("tu-1", true)], None);

    settle().await;
    assert_eq!(rescans(&deps), 0);
}

#[tokio::test]
async fn an_enter_worktree_tool_use_triggers_one_rescan_after_a_successful_result() {
    let (sink, deps) = sink();

    sink.on_message(vec![tool_use("tu-1", "EnterWorktree", None)], None);
    sink.on_tool_result(vec![tool_result("tu-1", false)], None);

    settle().await;
    assert_eq!(rescans(&deps), 1);
}

#[tokio::test]
async fn two_worktree_tool_uses_resolved_in_one_batch_trigger_only_one_rescan() {
    let (sink, deps) = sink();

    sink.on_message(
        vec![
            tool_use("tu-1", "Bash", Some("git worktree add ../wt-1")),
            tool_use("tu-2", "EnterWorktree", None),
        ],
        None,
    );
    sink.on_tool_result(
        vec![tool_result("tu-1", false), tool_result("tu-2", false)],
        None,
    );

    settle().await;
    assert_eq!(rescans(&deps), 1);
}

#[tokio::test]
async fn entering_and_leaving_a_worktree_each_report_a_transcript_move() {
    let (sink, deps) = sink();

    sink.on_message(vec![tool_use("tu-1", "EnterWorktree", None)], None);
    sink.on_tool_result(vec![tool_result("tu-1", false)], None);
    sink.on_message(vec![tool_use("tu-2", "ExitWorktree", None)], None);
    sink.on_tool_result(vec![tool_result("tu-2", false)], None);

    settle().await;
    assert_eq!(transcript_lookups(&deps), 2);
}

#[tokio::test]
async fn a_git_worktree_shell_command_or_a_failed_worktree_tool_moves_nothing() {
    let (sink, deps) = sink();

    sink.on_message(
        vec![
            tool_use("tu-1", "Bash", Some("git worktree add ../wt")),
            tool_use("tu-2", "EnterWorktree", None),
        ],
        None,
    );
    sink.on_tool_result(
        vec![tool_result("tu-1", false), tool_result("tu-2", true)],
        None,
    );

    settle().await;
    assert_eq!(transcript_lookups(&deps), 0);
}
