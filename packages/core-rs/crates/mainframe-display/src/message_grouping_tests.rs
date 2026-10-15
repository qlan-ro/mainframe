use super::*;
use mainframe_types::transcript_presentation::TURN_GROUP_KEY;
use serde_json::json;

fn msg(id: &str, t: ChatMessageType, content: Vec<MessageContent>) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: "c".to_string(),
        r#type: t,
        content,
        timestamp: "t".to_string(),
        metadata: None,
    }
}

fn tool_use(id: &str) -> MessageContent {
    MessageContent::Node(MessageContentNode::ToolUse {
        timing: None,
        command_execution: None,
        id: id.to_string(),
        name: "Bash".to_string(),
        input: HashMap::new(),
        parent_tool_use_id: None,
    })
}

fn tool_result(tool_use_id: &str) -> MessageContent {
    MessageContent::Node(MessageContentNode::ToolResult {
        tool_use_id: tool_use_id.to_string(),
        content: "R".to_string(),
        is_error: false,
        structured_patch: None,
        original_file: None,
        modified_file: None,
        images: Vec::new(),
        parent_tool_use_id: None,
    })
}

#[test]
fn merges_consecutive_assistant_tool_use_turns() {
    let out = group_messages(vec![
        msg("a1", ChatMessageType::Assistant, vec![tool_use("tu_1")]),
        msg("a2", ChatMessageType::ToolUse, vec![tool_use("tu_2")]),
    ]);
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].base.content.len(), 2);
}

#[test]
fn attaches_tool_results_to_preceding_turn() {
    let out = group_messages(vec![
        msg("a1", ChatMessageType::Assistant, vec![tool_use("tu_1")]),
        msg("r1", ChatMessageType::ToolResult, vec![tool_result("tu_1")]),
    ]);
    assert_eq!(out.len(), 1);
    assert!(out[0].tool_results.contains_key("tu_1"));
}

#[test]
fn dedupes_tool_use_by_id() {
    let out = group_messages(vec![msg(
        "a1",
        ChatMessageType::Assistant,
        vec![tool_use("tu_1"), tool_use("tu_1")],
    )]);
    assert_eq!(out[0].base.content.len(), 1);
}

#[test]
fn attaches_turn_duration_to_last_assistant_turn() {
    let mut sys = msg("s1", ChatMessageType::System, vec![]);
    let mut meta = HashMap::new();
    meta.insert("turnDurationMs".to_string(), json!(1234));
    sys.metadata = Some(meta);
    let out = group_messages(vec![
        msg("a1", ChatMessageType::Assistant, vec![tool_use("tu_1")]),
        sys,
    ]);
    assert_eq!(out.len(), 1);
    assert_eq!(
        out[0].base.metadata.as_ref().unwrap().get("turnDurationMs"),
        Some(&json!(1234))
    );
}

fn keyed(mut m: ChatMessage, key: &str) -> ChatMessage {
    m.metadata
        .get_or_insert_default()
        .insert(TURN_GROUP_KEY.to_string(), json!(key));
    m
}

fn text(t: &str) -> MessageContent {
    MessageContent::Leaf(mainframe_types::content::LeafContent::Text {
        text: t.to_string(),
        parent_tool_use_id: None,
    })
}

fn codex_turn(mut m: ChatMessage, turn: &str, parent: Option<&str>) -> ChatMessage {
    let mut context = json!({
        "version": 1, "provider": "codex", "turnId": turn,
        "state": "completed", "finalEligible": false,
    });
    if let Some(parent) = parent {
        context["parentToolUseId"] = json!(parent);
    }
    m.metadata
        .get_or_insert_default()
        .insert("transcriptPresentation".to_string(), context);
    m
}

fn texts(group: &GroupedMessage) -> Vec<String> {
    group
        .base
        .content
        .iter()
        .filter_map(|block| match block {
            MessageContent::Leaf(mainframe_types::content::LeafContent::Text { text, .. }) => {
                Some(text.clone())
            }
            _ => None,
        })
        .collect()
}

#[test]
fn known_distinct_turn_groups_never_merge() {
    let limit = "You've hit your session limit · resets 4:20pm";
    let out = group_messages(vec![
        keyed(
            msg("a1", ChatMessageType::Assistant, vec![text(limit)]),
            "p1",
        ),
        keyed(
            msg("a2", ChatMessageType::Assistant, vec![text(limit)]),
            "p2",
        ),
        keyed(
            msg("a3", ChatMessageType::Assistant, vec![text(limit)]),
            "p3",
        ),
    ]);
    assert_eq!(out.len(), 3);
    for group in &out {
        assert_eq!(texts(group), [limit]);
    }
}

#[test]
fn one_turn_group_keeps_its_tool_cycle_together() {
    let out = group_messages(vec![
        keyed(
            msg("a1", ChatMessageType::Assistant, vec![tool_use("tu_1")]),
            "p1",
        ),
        msg("r1", ChatMessageType::ToolResult, vec![tool_result("tu_1")]),
        keyed(
            msg("a2", ChatMessageType::Assistant, vec![text("done")]),
            "p1",
        ),
        keyed(
            msg("a3", ChatMessageType::Assistant, vec![text("next")]),
            "p2",
        ),
    ]);
    assert_eq!(out.len(), 2);
    assert!(out[0].tool_results.contains_key("tu_1"));
    assert_eq!(texts(&out[0]), ["done"]);
    assert_eq!(texts(&out[1]), ["next"]);
}

#[test]
fn unknown_turn_groups_join_their_neighbours_but_not_a_new_known_group() {
    let out = group_messages(vec![
        keyed(
            msg("a1", ChatMessageType::Assistant, vec![text("one")]),
            "p1",
        ),
        msg("a2", ChatMessageType::Assistant, vec![text("two")]),
        keyed(
            msg("a3", ChatMessageType::Assistant, vec![text("three")]),
            "p1",
        ),
        msg("a4", ChatMessageType::Assistant, vec![text("four")]),
        keyed(
            msg("a5", ChatMessageType::Assistant, vec![text("five")]),
            "p2",
        ),
    ]);
    assert_eq!(out.len(), 2);
    assert_eq!(texts(&out[0]), ["one", "two", "three", "four"]);
    assert_eq!(texts(&out[1]), ["five"]);
}

#[test]
fn codex_turn_ids_split_groups_but_child_and_claude_contexts_do_not() {
    let a = |id: &str| msg(id, ChatMessageType::Assistant, vec![text(id)]);
    let out = group_messages(vec![
        codex_turn(a("t1"), "[\"th\",\"turn-1\"]", None),
        codex_turn(a("child"), "[\"child\",\"turn-9\"]", Some("tu_agent")),
        codex_turn(a("t1b"), "[\"th\",\"turn-1\"]", None),
        codex_turn(a("t2"), "[\"th\",\"turn-2\"]", None),
    ]);
    assert_eq!(out.len(), 2);
    assert_eq!(texts(&out[0]), ["t1", "child", "t1b"]);
    assert_eq!(texts(&out[1]), ["t2"]);

    let mut claude = codex_turn(a("c2"), "[\"s\",\"epoch-2\"]", None);
    claude
        .metadata
        .as_mut()
        .unwrap()
        .get_mut("transcriptPresentation")
        .unwrap()["provider"] = json!("claude");
    let mut first = codex_turn(a("c1"), "[\"s\",\"epoch-1\"]", None);
    first
        .metadata
        .as_mut()
        .unwrap()
        .get_mut("transcriptPresentation")
        .unwrap()["provider"] = json!("claude");
    assert_eq!(group_messages(vec![first, claude]).len(), 1);
}

#[test]
fn late_parallel_results_follow_their_tool_owners() {
    let out = group_messages(vec![
        keyed(
            msg("a1", ChatMessageType::Assistant, vec![tool_use("t1")]),
            "p1",
        ),
        keyed(
            msg("a2", ChatMessageType::Assistant, vec![tool_use("t2")]),
            "p2",
        ),
        msg(
            "r",
            ChatMessageType::ToolResult,
            vec![tool_result("t1"), tool_result("t2"), tool_result("orphan")],
        ),
    ]);
    assert_eq!(out.len(), 2);
    assert!(out[0].tool_results.contains_key("t1"));
    assert!(!out[1].tool_results.contains_key("t1"));
    assert!(out[1].tool_results.contains_key("t2"));
    assert!(out[1].tool_results.contains_key("orphan"));
}

#[test]
fn late_results_keep_first_tool_owner_and_orphan_grouping() {
    let out = group_messages(vec![
        msg(
            "orphan",
            ChatMessageType::ToolResult,
            vec![tool_result("missing")],
        ),
        keyed(
            msg("first", ChatMessageType::Assistant, vec![tool_use("t")]),
            "p1",
        ),
        keyed(
            msg("duplicate", ChatMessageType::Assistant, vec![tool_use("t")]),
            "p2",
        ),
        msg("user", ChatMessageType::User, vec![text("next")]),
        msg(
            "result",
            ChatMessageType::ToolResult,
            vec![tool_result("t"), tool_result("missing")],
        ),
    ]);
    assert_eq!(out.len(), 5);
    assert!(out[1].tool_results.contains_key("t"));
    assert!(out[2].base.content.is_empty());
    assert!(out[2].tool_results.is_empty());
    assert_eq!(out[4].base.content, vec![tool_result("missing")]);
}
