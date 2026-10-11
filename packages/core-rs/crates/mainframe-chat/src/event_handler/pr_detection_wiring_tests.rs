//! `build_sink` wraps its `SessionSinkImpl` in `PrDetectionSink`, so every
//! adapter inherits live PR detection through the session sink.

use super::tests::Harness;
use super::*;
use crate::test_support::{FakeDeps, test_chat};

/// A sink over a fresh "chat-pr".
fn sink() -> (Arc<dyn SessionSink>, Arc<FakeDeps>) {
    let h = Harness::new(Arc::new(Mutex::new(ActiveChat::new(
        test_chat("chat-pr"),
        None,
    ))));
    (h.sink("chat-pr"), h.deps)
}

fn bash_create_tool_use() -> MessageContent {
    let mut input = HashMap::new();
    input.insert(
        "command".to_string(),
        serde_json::Value::String("gh pr create --title x".to_string()),
    );
    MessageContent::Node(MessageContentNode::ToolUse {
        timing: None,
        command_execution: None,
        id: "tu1".to_string(),
        name: "Bash".to_string(),
        input,
        parent_tool_use_id: None,
    })
}

fn pr_url_tool_result() -> MessageContent {
    MessageContent::Node(MessageContentNode::ToolResult {
        tool_use_id: "tu1".to_string(),
        content: "Created https://github.com/acme/repo/pull/7".to_string(),
        is_error: false,
        structured_patch: None,
        original_file: None,
        modified_file: None,
        images: Vec::new(),
        parent_tool_use_id: None,
    })
}

#[test]
fn a_bash_pr_create_and_its_result_persist_and_emit_through_the_wired_sink() {
    let (sink, deps) = sink();

    sink.on_message(vec![bash_create_tool_use()], None);
    sink.on_tool_result(vec![pr_url_tool_result()], None);

    let expected = DetectedPr {
        url: "https://github.com/acme/repo/pull/7".to_string(),
        owner: "acme".to_string(),
        repo: "repo".to_string(),
        number: 7,
        source: mainframe_types::adapter::DetectedPrSource::Created,
    };
    assert_eq!(
        deps.store.detected_prs.lock().unwrap().as_slice(),
        std::slice::from_ref(&expected)
    );
    // The real sink also emits ChatUpdated/MessageAdded for the underlying
    // tool_use/tool_result traffic (SessionSinkImpl's own job); this asserts
    // only that ChatPrDetected — the wiring under test — is among them.
    assert!(deps.events().contains(&DaemonEvent::ChatPrDetected {
        chat_id: "chat-pr".to_string(),
        pr: expected,
    }));
}
