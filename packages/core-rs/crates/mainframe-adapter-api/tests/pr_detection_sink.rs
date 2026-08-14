//! Live-detection specs for `PrDetectionSink`, the `SessionSink` decorator that
//! runs PR scanning at the one seam every adapter crosses (todo #339, tasks
//! 6-8). Red-phase until Group C lands `PrDetectionSink`
//! (`pr_detection/sink.rs`): expect "cannot find type/function `PrDetectionSink`"
//! until then — do not weaken these specs to make them compile early.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::pr_detection::PrDetectionSink;
use mainframe_adapter_api::{AdapterError, LoadedSkill, SessionSink};
use mainframe_types::adapter::{
    ContextUsage, ControlRequest, DetectedPr, DetectedPrSource, MessageMetadata, SessionResult,
};
use mainframe_types::chat::{MessageContent, MessageContentNode, TodoItem};
use mainframe_types::context::SkillFileEntry;
use serde_json::Value;

#[derive(Default)]
struct RecordingSink {
    prs: Mutex<Vec<DetectedPr>>,
}

impl RecordingSink {
    fn prs(&self) -> Vec<DetectedPr> {
        self.prs.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

impl SessionSink for RecordingSink {
    fn on_init(&self, _session_id: &str) {}
    fn on_message(&self, _content: Vec<MessageContent>, _metadata: Option<MessageMetadata>) {}
    fn on_tool_result(&self, _content: Vec<MessageContent>) {}
    fn on_permission(&self, _request: ControlRequest) {}
    fn on_result(&self, _data: SessionResult) {}
    fn on_exit(&self, _code: Option<i32>) {}
    fn on_error(&self, _error: AdapterError) {}
    fn on_compact(&self) {}
    fn on_compact_start(&self) {}
    fn on_context_usage(&self, _usage: ContextUsage) {}
    fn on_plan_file(&self, _file_path: &str) {}
    fn on_skill_file(&self, _entry: SkillFileEntry) {}
    fn on_queued_processed(&self, _uuid: &str) {}
    fn on_todo_update(&self, _todos: Vec<TodoItem>) {}
    fn on_pr_detected(&self, pr: DetectedPr) {
        self.prs.lock().unwrap_or_else(|e| e.into_inner()).push(pr);
    }
    fn on_cli_message(&self, _text: &str) {}
    fn on_skill_loaded(&self, _entry: LoadedSkill) {}
    fn on_subagent_child(&self, _parent_tool_use_id: &str, _blocks: Vec<MessageContent>) {}
}

fn tool_use(id: &str, name: &str, command: Option<&str>) -> MessageContent {
    let mut input = HashMap::new();
    if let Some(command) = command {
        input.insert("command".to_string(), Value::String(command.to_string()));
    }
    MessageContent::Node(MessageContentNode::ToolUse {
        id: id.to_string(),
        name: name.to_string(),
        input,
        parent_tool_use_id: None,
    })
}

fn bash_tool_use(id: &str, command: &str) -> MessageContent {
    tool_use(id, "Bash", Some(command))
}

fn tool_result(tool_use_id: &str, content: &str, is_error: bool) -> MessageContent {
    MessageContent::Node(MessageContentNode::ToolResult {
        tool_use_id: tool_use_id.to_string(),
        content: content.to_string(),
        is_error,
        structured_patch: None,
        original_file: None,
        modified_file: None,
        parent_tool_use_id: None,
    })
}

fn drive(tool_use_block: MessageContent, result_block: MessageContent) -> Vec<DetectedPr> {
    let inner = Arc::new(RecordingSink::default());
    let sink = PrDetectionSink::new(inner.clone());
    sink.on_message(vec![tool_use_block], None);
    sink.on_tool_result(vec![result_block]);
    inner.prs()
}

// --- Task 6: Claude-shaped input ---------------------------------------

#[test]
fn bash_pr_create_command_and_pr_url_result_yields_created_source() {
    let prs = drive(
        bash_tool_use("tu1", "gh pr create --title x"),
        tool_result("tu1", "Created https://github.com/acme/repo/pull/7", false),
    );
    assert_eq!(
        prs,
        vec![DetectedPr {
            url: "https://github.com/acme/repo/pull/7".to_string(),
            owner: "acme".to_string(),
            repo: "repo".to_string(),
            number: 7,
            source: DetectedPrSource::Created,
        }]
    );
}

#[test]
fn bash_pr_view_command_result_containing_pr_url_yields_mentioned() {
    let prs = drive(
        bash_tool_use("tu1", "gh pr view 42"),
        tool_result("tu1", "See https://github.com/acme/repo/pull/8", false),
    );
    assert_eq!(
        prs,
        vec![DetectedPr {
            url: "https://github.com/acme/repo/pull/8".to_string(),
            owner: "acme".to_string(),
            repo: "repo".to_string(),
            number: 8,
            source: DetectedPrSource::Mentioned,
        }]
    );
}

#[test]
fn non_pr_relevant_bash_command_result_emits_nothing() {
    let prs = drive(
        bash_tool_use("tu1", "npm test"),
        tool_result(
            "tu1",
            "https://github.com/acme/repo/pull/8 (unrelated)",
            false,
        ),
    );
    assert!(prs.is_empty());
}

#[test]
fn tool_result_for_a_non_scanned_tool_emits_nothing() {
    let prs = drive(
        tool_use("tu1", "Read", None),
        tool_result("tu1", "https://github.com/acme/repo/pull/8", false),
    );
    assert!(prs.is_empty());
}

#[test]
fn agent_tool_result_containing_pr_url_yields_mentioned() {
    let prs = drive(
        tool_use("tu1", "Agent", None),
        tool_result("tu1", "https://github.com/acme/repo/pull/11", false),
    );
    assert_eq!(
        prs,
        vec![DetectedPr {
            url: "https://github.com/acme/repo/pull/11".to_string(),
            owner: "acme".to_string(),
            repo: "repo".to_string(),
            number: 11,
            source: DetectedPrSource::Mentioned,
        }]
    );
}

#[test]
fn task_tool_result_containing_pr_url_yields_mentioned() {
    let prs = drive(
        tool_use("tu1", "Task", None),
        tool_result("tu1", "https://github.com/acme/repo/pull/12", false),
    );
    assert_eq!(
        prs,
        vec![DetectedPr {
            url: "https://github.com/acme/repo/pull/12".to_string(),
            owner: "acme".to_string(),
            repo: "repo".to_string(),
            number: 12,
            source: DetectedPrSource::Mentioned,
        }]
    );
}

#[test]
fn tool_result_with_no_registered_tool_use_emits_nothing() {
    let inner = Arc::new(RecordingSink::default());
    let sink = PrDetectionSink::new(inner.clone());
    sink.on_tool_result(vec![tool_result(
        "tu-unregistered",
        "https://github.com/acme/repo/pull/8",
        false,
    )]);
    assert!(inner.prs().is_empty());
}

#[test]
fn gh_pr_mutation_command_with_non_error_result_yields_mentioned_from_reconstructed_url() {
    let prs = drive(
        bash_tool_use("tu2", "gh pr ready org/repo#42"),
        tool_result("tu2", "Marked ready for review", false),
    );
    assert_eq!(
        prs,
        vec![DetectedPr {
            url: "https://github.com/org/repo/pull/42".to_string(),
            owner: "org".to_string(),
            repo: "repo".to_string(),
            number: 42,
            source: DetectedPrSource::Mentioned,
        }]
    );
}

#[test]
fn gh_pr_mutation_command_with_error_result_emits_nothing() {
    let prs = drive(
        bash_tool_use("tu2", "gh pr ready org/repo#42"),
        tool_result("tu2", "Marked ready for review", true),
    );
    assert!(prs.is_empty());
}

#[test]
fn gitlab_mr_create_result_yields_the_right_owner_repo_number() {
    let prs = drive(
        bash_tool_use("tu-gitlab", "glab mr create --title x"),
        tool_result(
            "tu-gitlab",
            "Created https://gitlab.com/acme/backend/-/merge_requests/99",
            false,
        ),
    );
    assert_eq!(
        prs,
        vec![DetectedPr {
            url: "https://gitlab.com/acme/backend/-/merge_requests/99".to_string(),
            owner: "acme".to_string(),
            repo: "backend".to_string(),
            number: 99,
            source: DetectedPrSource::Created,
        }]
    );
}

#[test]
fn azure_pr_create_result_yields_the_right_owner_repo_number() {
    let prs = drive(
        bash_tool_use("tu-azure", "az repos pr create --title x"),
        tool_result(
            "tu-azure",
            "https://dev.azure.com/myorg/proj/_git/myrepo/pullrequest/5",
            false,
        ),
    );
    assert_eq!(
        prs,
        vec![DetectedPr {
            url: "https://dev.azure.com/myorg/proj/_git/myrepo/pullrequest/5".to_string(),
            owner: "myorg".to_string(),
            repo: "myrepo".to_string(),
            number: 5,
            source: DetectedPrSource::Created,
        }]
    );
}

#[test]
fn azure_pr_json_payload_result_yields_the_right_owner_repo_number() {
    let payload = "{\"pullRequestId\": 55, \"name\": \"myrepo\", \"url\": \"https://dev.azure.com/myorg/myproject/_apis/git/repositories/x/pullRequests/55\"}";
    let prs = drive(
        bash_tool_use("tu-azure-json", "az repos pr create --title x"),
        tool_result("tu-azure-json", payload, false),
    );
    assert_eq!(
        prs,
        vec![DetectedPr {
            url: payload.to_string(),
            owner: "myorg".to_string(),
            repo: "myrepo".to_string(),
            number: 55,
            source: DetectedPrSource::Created,
        }]
    );
}

// --- Task 7: Codex-shaped parity ----------------------------------------

/// Built the way `thread_item_render.rs::render_command_execution` builds it:
/// one `Bash` tool_use carrying the raw shell command, then one tool_result
/// carrying the aggregated output. Same shape the live Codex stream emits.
#[test]
fn codex_shaped_input_produces_the_same_pr_as_claude_shaped_input_for_the_same_url() {
    let claude_prs = drive(
        bash_tool_use("tu1", "gh pr create --title x"),
        tool_result(
            "tu1",
            "Created https://github.com/qlan-ro/mainframe/pull/614",
            false,
        ),
    );
    let codex_prs = drive(
        bash_tool_use(
            "call_1",
            "/bin/zsh -lc 'gh pr create --base main --head fix/x --title x --body y'",
        ),
        tool_result(
            "call_1",
            "Script completed\nOutput:\nhttps://github.com/qlan-ro/mainframe/pull/614\n",
            false,
        ),
    );

    assert_eq!(claude_prs, codex_prs);
    assert_eq!(
        codex_prs,
        vec![DetectedPr {
            url: "https://github.com/qlan-ro/mainframe/pull/614".to_string(),
            owner: "qlan-ro".to_string(),
            repo: "mainframe".to_string(),
            number: 614,
            source: DetectedPrSource::Created,
        }]
    );
}
