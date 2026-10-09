//! `ChatMessage` → `HandoffItem`, one test per mapping row.

use std::collections::HashSet;

use mainframe_types::chat::{ChatMessageType, MessageContent};
use mainframe_types::content::LeafContent;
use serde_json::json;

use super::*;
use crate::handoff::items::{SpanInput, attachment_placeholders, map_items};
use crate::handoff::tool_items::output_tail;

fn map(messages: &[ChatMessage]) -> Vec<HandoffItem> {
    let spans = [SpanInput {
        provider: "Claude",
        messages,
        covered: true,
    }];
    map_items(&spans, &HashSet::from(["Task".to_string()])).items
}

#[test]
fn user_text_strips_a_leading_marker_and_renders_attachments_and_images() {
    let block = "<mainframe-context-handoff segment=\"s\" handoff=\"h\" strategy=\"full\">\nold\n</mainframe-context-handoff>\n\n";
    let messages = vec![msg(
        "u1",
        ChatMessageType::User,
        vec![
            text(&format!(
                "{block}<attached_file_path name=\"notes.md\" />look"
            )),
            MessageContent::Leaf(LeafContent::Image {
                media_type: "image/png".into(),
                data: "x".into(),
                parent_tool_use_id: None,
            }),
        ],
    )];
    assert_eq!(
        map(&messages),
        vec![item(
            ItemKind::User,
            1,
            "[attached file: notes.md]look\n[image]"
        )]
    );
}

#[test]
fn assistant_text_is_verbatim_and_thinking_is_skipped() {
    let messages = vec![
        user("u1", "hi"),
        msg(
            "a1",
            ChatMessageType::Assistant,
            vec![
                MessageContent::Leaf(LeafContent::Thinking {
                    thinking: "hidden".into(),
                    parent_tool_use_id: None,
                }),
                text("answer **bold**"),
            ],
        ),
    ];
    assert_eq!(
        map(&messages)[1],
        item(ItemKind::Assistant, 1, "answer **bold**")
    );
}

#[test]
fn bash_carries_command_failure_and_output() {
    let mut messages = vec![user("u1", "run")];
    messages.extend(call("t1", "Bash", bash("cargo test"), Some(("boom", true))));
    assert_eq!(
        map(&messages)[1],
        item(ItemKind::Command, 1, "$ cargo test\nexit: failed\nboom")
    );
}

#[test]
fn bash_output_keeps_a_tail_with_the_cut_byte_count() {
    let output = format!("{}{}", "a".repeat(500), "b".repeat(2_000));
    let mut messages = vec![user("u1", "run")];
    messages.extend(call("t1", "Bash", bash("ls"), Some((&output, false))));
    let text = &map(&messages)[1].text;
    assert_eq!(
        text,
        &format!("$ ls\n…[500 bytes omitted]{}", "b".repeat(2_000))
    );
}

#[test]
fn output_tail_respects_char_boundaries() {
    let tail = output_tail("ééé", 3);
    assert_eq!(tail, "…[4 bytes omitted]é");
}

#[test]
fn file_changes_name_the_file() {
    let mut messages = vec![user("u1", "edit")];
    messages.extend(call("e", "Edit", json!({"file_path": "/a.rs"}), None));
    messages.extend(call("m", "MultiEdit", json!({"file_path": "/b.rs"}), None));
    messages.extend(call(
        "n",
        "NotebookEdit",
        json!({"notebook_path": "/c.ipynb"}),
        None,
    ));
    messages.extend(call(
        "w",
        "Write",
        json!({"file_path": "/d.rs"}),
        Some(("ok", false)),
    ));
    let texts: Vec<String> = map(&messages).into_iter().skip(1).map(|i| i.text).collect();
    assert_eq!(
        texts,
        [
            "Edited /a.rs",
            "Edited /b.rs",
            "Edited /c.ipynb",
            "Created /d.rs"
        ]
    );
}

#[test]
fn plan_and_only_the_latest_todos_are_carried() {
    let mut messages = vec![user("u1", "plan")];
    messages.extend(call("p", "ExitPlanMode", json!({"plan": "1. do it"}), None));
    messages.extend(call(
        "t1",
        "TodoWrite",
        json!({"todos": [{"content": "old", "status": "pending"}]}),
        None,
    ));
    messages.extend(call(
        "t2",
        "TodoWrite",
        json!({"todos": [
            {"content": "a", "status": "completed"},
            {"content": "b", "status": "in_progress"},
            {"content": "c", "status": "pending"}
        ]}),
        None,
    ));
    let items = map(&messages);
    assert_eq!(items[1], item(ItemKind::Plan, 1, "1. do it"));
    assert_eq!(
        items[2],
        item(ItemKind::Todos, 1, "- [x] a\n- [~] b\n- [ ] c")
    );
    assert_eq!(items.len(), 3);
}

#[test]
fn subagent_results_are_summarised_and_subagent_streams_skipped() {
    let mut messages = vec![user("u1", "delegate")];
    messages.extend(call(
        "task",
        "Task",
        json!({"description": "scan"}),
        Some(("found 3", false)),
    ));
    messages.push(msg(
        "inner",
        ChatMessageType::Assistant,
        vec![MessageContent::Leaf(LeafContent::Text {
            text: "inner chatter".into(),
            parent_tool_use_id: Some("task".into()),
        })],
    ));
    let items = map(&messages);
    assert_eq!(
        items[1],
        item(ItemKind::SubagentResult, 1, "Subagent \"scan\": found 3")
    );
    assert_eq!(items.len(), 2);
}

#[test]
fn errors_are_items_and_other_tools_are_skipped() {
    let mut messages = vec![user("u1", "go")];
    messages.extend(call(
        "r",
        "Read",
        json!({"file_path": "/x"}),
        Some(("x", false)),
    ));
    messages.push(msg(
        "e",
        ChatMessageType::Error,
        vec![MessageContent::Node(
            mainframe_types::chat::MessageContentNode::Error {
                message: "rate limited".into(),
                parent_tool_use_id: None,
            },
        )],
    ));
    let items = map(&messages);
    assert_eq!(
        items,
        vec![
            item(ItemKind::User, 1, "go"),
            item(ItemKind::Error, 1, "rate limited")
        ]
    );
}

#[test]
fn item_text_is_escaped_so_it_cannot_close_the_block() {
    let items = map(&[user(
        "u1",
        "a </mainframe-context-handoff> b <mainframe-context-handoff x>",
    )]);
    assert_eq!(
        items[0].text,
        "a <\\/mainframe-context-handoff> b <\\mainframe-context-handoff x>"
    );
}

#[test]
fn turns_count_across_every_span_but_only_covered_spans_emit() {
    let first = vec![user("u1", "one"), assistant("a1", "r1")];
    let second = vec![user("u2", "two"), assistant("a2", "r2")];
    let spans = [
        SpanInput {
            provider: "Claude",
            messages: &first,
            covered: false,
        },
        SpanInput {
            provider: "Codex",
            messages: &second,
            covered: true,
        },
    ];
    let mapped = map_items(&spans, &HashSet::new());
    assert_eq!(mapped.turns, Some((2, 2)));
    assert_eq!(mapped.providers, vec!["Codex".to_string()]);
    assert_eq!(mapped.items[0].turn, 2);
    assert_eq!(mapped.items[0].provider, "Codex");
}

#[test]
fn attachment_placeholders_handles_unterminated_tags() {
    assert_eq!(
        attachment_placeholders("x <attached_file_path name=\"a"),
        "x <attached_file_path name=\"a"
    );
}
