use super::*;
use crate::messages::message_grouping::GroupedMessage;
use mainframe_adapter_api::pr_detection::extract_pr_from_tool_result;
use mainframe_display::truncate_tool_content::TRUNCATE_THRESHOLD_BYTES;
use mainframe_types::chat::{ChatMessage, ChatMessageType};
use mainframe_types::display::DisplayContent;
use serde_json::json;

fn content_from(v: Value) -> MessageContent {
    serde_json::from_value(v).unwrap()
}

fn categories(v: Value) -> ToolCategories {
    serde_json::from_value(v).unwrap()
}

// ── convertAssistantContent — AskUserQuestion ──────────────────────────────
fn grouped_auq(tool_use_id: &str, with_result: bool) -> GroupedMessage {
    let base = ChatMessage {
        id: "g".to_string(),
        chat_id: "c".to_string(),
        r#type: ChatMessageType::Assistant,
        content: vec![content_from(json!({
            "type": "tool_use",
            "id": tool_use_id,
            "name": "AskUserQuestion",
            "input": { "questions": [{ "question": "Which DB?" }] },
        }))],
        timestamp: "t".to_string(),
        metadata: None,
    };
    let mut tool_results = HashMap::new();
    if with_result {
        tool_results.insert(
            tool_use_id.to_string(),
            content_from(json!({
                "type": "tool_result",
                "toolUseId": tool_use_id,
                "content": "User has answered your questions: \"Which DB?\"=\"Postgres\". You can now continue with the user's answers in mind.",
                "isError": false,
            })),
        );
    }
    GroupedMessage { base, tool_results }
}

fn auq_categories() -> ToolCategories {
    categories(json!({
        "explore": [],
        "hidden": ["AskUserQuestion"],
        "progress": [],
        "subagent": [],
    }))
}

fn find_tool_call(content: &[DisplayContent]) -> Value {
    content
        .iter()
        .map(|c| serde_json::to_value(c).unwrap())
        .find(|v| v["type"] == "tool_call")
        .expect("a tool_call")
}

#[test]
fn answered_ask_user_question_is_category_default_with_parsed_answers() {
    let cats = auq_categories();
    let out = convert_assistant_content(&grouped_auq("tu1", true), Some(&cats));
    let call = find_tool_call(&out);
    assert_eq!(call["category"], "default");
    assert_eq!(
        call["result"]["askUserQuestion"],
        json!([{ "question": "Which DB?", "answer": ["Postgres"] }])
    );
}

#[test]
fn pending_resultless_ask_user_question_stays_hidden() {
    let cats = auq_categories();
    let out = convert_assistant_content(&grouped_auq("tu2", false), Some(&cats));
    let call = find_tool_call(&out);
    assert_eq!(call["category"], "hidden");
}

// ── convertAssistantContent — #419 subagent results + hidden thinking ───────
fn grouped_from(blocks: Vec<Value>) -> GroupedMessage {
    let base = ChatMessage {
        id: "g".to_string(),
        chat_id: "c".to_string(),
        r#type: ChatMessageType::Assistant,
        content: blocks.into_iter().map(content_from).collect(),
        timestamp: "t".to_string(),
        metadata: None,
    };
    GroupedMessage {
        base,
        tool_results: HashMap::new(),
    }
}

#[test]
fn skips_empty_prose_thinking_blocks() {
    let g = grouped_from(vec![
        json!({ "type": "thinking", "thinking": "  \n " }),
        json!({ "type": "thinking", "thinking": "real reasoning" }),
    ]);
    let out = convert_assistant_content(&g, None);
    let thinkings: Vec<Value> = out
        .iter()
        .map(|c| serde_json::to_value(c).unwrap())
        .filter(|v| v["type"] == "thinking")
        .collect();
    assert_eq!(thinkings.len(), 1);
    assert_eq!(thinkings[0]["thinking"], "real reasoning");
}

#[test]
fn surfaces_in_content_tool_result_on_child_tool_call() {
    // Live shape: subagent child results are appended as tool_result blocks
    // inside the same assistant content (not standalone messages).
    let g = grouped_from(vec![
        json!({ "type": "tool_use", "id": "c1", "name": "Bash", "input": { "command": "ls" }, "parentToolUseId": "task1" }),
        json!({ "type": "tool_result", "toolUseId": "c1", "content": "child-output", "isError": false, "parentToolUseId": "task1" }),
    ]);
    let out = convert_assistant_content(&g, None);
    let call = find_tool_call(&out);
    assert_eq!(call["id"], "c1");
    assert_eq!(call["result"]["content"], "child-output");
}

// ── toToolCallResult truncation ────────────────────────────────────────────
#[test]
fn flags_and_shrinks_oversized_content() {
    let big = "A".repeat(TRUNCATE_THRESHOLD_BYTES + 5000);
    let block = content_from(json!({
        "type": "tool_result", "toolUseId": "id1", "content": big, "isError": false,
    }));
    let r = to_tool_call_result(&block, None, None).unwrap();
    assert_eq!(r.truncated, Some(true));
    assert_eq!(r.full_bytes, Some((TRUNCATE_THRESHOLD_BYTES + 5000) as i64));
    assert!(r.content.len() < TRUNCATE_THRESHOLD_BYTES + 5000);
}

#[test]
fn leaves_small_content_and_structured_fields_intact() {
    let block = content_from(json!({
        "type": "tool_result", "toolUseId": "id2", "content": "ok", "isError": false,
        "structuredPatch": [{ "oldStart": 1, "oldLines": 1, "newStart": 1, "newLines": 1, "lines": ["-a", "+b"] }],
    }));
    let r = to_tool_call_result(&block, None, None).unwrap();
    assert_eq!(r.truncated, None);
    assert_eq!(r.content, "ok");
    assert_eq!(r.structured_patch.as_ref().map(Vec::len), Some(1));
}

#[test]
fn ingestion_pr_detection_runs_on_full_content_unaffected_by_display_truncation() {
    let url = "https://github.com/acme/repo/pull/4242";
    let filler = (0..3000)
        .map(|i| format!("noise line {i}"))
        .collect::<Vec<_>>()
        .join("\n");
    let huge = format!("{filler}\n{url}\n{filler}");
    assert!(!truncate_tool_content(&huge).content.contains("4242"));
    let result = extract_pr_from_tool_result(&huge);
    assert_eq!(result.map(|p| p.number), Some(4242));
}

// ── applyToolGrouping — task_group agentId uniqueness (regression #184) ─────
fn regression_184_categories() -> ToolCategories {
    categories(json!({
        "explore": [],
        "hidden": [],
        "progress": [],
        "subagent": ["CollabAgent"],
    }))
}

fn task_groups(out: &[DisplayContent]) -> Vec<Value> {
    out.iter()
        .map(|c| serde_json::to_value(c).unwrap())
        .filter(|v| v["type"] == "task_group")
        .collect()
}

fn tool_call_ids(calls: &Value) -> Vec<String> {
    calls
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["type"] == "tool_call")
        .map(|c| c["id"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn uses_the_unique_tool_use_id_as_agent_id_even_when_descriptions_repeat() {
    let cats = regression_184_categories();
    let content: Vec<DisplayContent> = serde_json::from_value(json!([
        { "type": "tool_call", "id": "call-A", "name": "CollabAgent",
          "input": { "prompt": "p1", "description": "default", "subagent_type": "role" }, "category": "subagent" },
        { "type": "tool_call", "id": "child-A", "name": "Bash",
          "input": { "command": "echo a" }, "category": "default", "parentToolUseId": "call-A" },
        { "type": "tool_call", "id": "call-B", "name": "CollabAgent",
          "input": { "prompt": "p2", "description": "default", "subagent_type": "role" }, "category": "subagent" },
        { "type": "tool_call", "id": "child-B", "name": "Bash",
          "input": { "command": "echo b" }, "category": "default", "parentToolUseId": "call-B" },
    ]))
    .unwrap();

    let out = apply_tool_grouping(content, &cats);
    let groups = task_groups(&out);
    assert_eq!(groups.len(), 2);
    assert_eq!(groups[0]["agentId"], "call-A");
    assert_eq!(groups[1]["agentId"], "call-B");
    assert_ne!(groups[0]["agentId"], groups[1]["agentId"]);
    assert_eq!(tool_call_ids(&groups[0]["calls"]), vec!["child-A"]);
    assert_eq!(tool_call_ids(&groups[1]["calls"]), vec!["child-B"]);
}

#[test]
fn preserves_grouping_for_a_single_subagent() {
    let cats = regression_184_categories();
    let content: Vec<DisplayContent> = serde_json::from_value(json!([
        { "type": "tool_call", "id": "toolu_001", "name": "CollabAgent",
          "input": { "description": "investigate auth bug", "prompt": "..." }, "category": "subagent" },
        { "type": "tool_call", "id": "toolu_002", "name": "Read",
          "input": { "file_path": "/auth.ts" }, "category": "default", "parentToolUseId": "toolu_001" },
        { "type": "tool_call", "id": "toolu_003", "name": "Grep",
          "input": { "pattern": "login" }, "category": "default", "parentToolUseId": "toolu_001" },
    ]))
    .unwrap();

    let out = apply_tool_grouping(content, &cats);
    let groups = task_groups(&out);
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0]["agentId"], "toolu_001");
    assert_eq!(groups[0]["taskArgs"]["description"], "investigate auth bug");
    assert_eq!(groups[0]["calls"].as_array().unwrap().len(), 2);
}
