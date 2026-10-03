use super::super::*;
use super::*;
#[test]
fn routes_raw_string_content_to_subagent_child() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "user", "parent_tool_use_id": "toolu_parent_agent", "message": { "role": "user", "content": "raw string body" } }),
    );
    let rec = sink.r();
    let (parent, blocks) = &rec.subagent[0];
    assert_eq!(parent, "toolu_parent_agent");
    assert_eq!(
        block_value(blocks, 0),
        serde_json::json!({ "type": "text", "text": "raw string body", "parentToolUseId": "toolu_parent_agent" })
    );
}

#[test]
fn extracts_skill_loaded_from_subagent_array_content() {
    let s = session();
    let sink = RecordingSink::default();
    let text = "<command-name>brainstorming</command-name>\n<skill-format>true</skill-format>\nBase directory for this skill: /home/user/.claude/skills/brainstorming\n# Brainstorming\n\nThink broadly.";
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "user", "parent_tool_use_id": "toolu_parent_agent", "message": { "role": "user", "content": [ { "type": "text", "text": text } ] } }),
    );
    let rec = sink.r();
    let (parent, blocks) = &rec.subagent[0];
    assert_eq!(parent, "toolu_parent_agent");
    assert_eq!(blocks.len(), 1);
    let v = block_value(blocks, 0);
    assert_eq!(v["type"], "skill_loaded");
    assert_eq!(v["skillName"], "brainstorming");
    assert_eq!(
        v["path"],
        "/home/user/.claude/skills/brainstorming/SKILL.md"
    );
    assert_eq!(v["parentToolUseId"], "toolu_parent_agent");
    assert!(!v["content"].as_str().unwrap().contains("<skill-format>"));
}

#[test]
fn subagent_push_notification_is_recorded_too() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({
            "type": "assistant",
            "parent_tool_use_id": "toolu_parent_agent",
            "message": { "content": [
                { "type": "tool_use", "id": "tu_1", "name": "PushNotification", "input": { "message": "subagent needs input" } }
            ] }
        }),
    );
    assert_eq!(sink.r().attention_requests, vec!["subagent needs input"]);
}

#[test]
fn routes_subagent_tool_result_via_subagent_child_not_tool_result() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({
            "type": "user",
            "parent_tool_use_id": "toolu_parent_agent",
            "message": { "role": "user", "content": [ { "type": "tool_result", "tool_use_id": "toolu_subagent_bash", "content": "hi" } ] }
        }),
    );
    assert_eq!(sink.r().tool_results, 0);
    let rec = sink.r();
    let (parent, blocks) = &rec.subagent[0];
    assert_eq!(parent, "toolu_parent_agent");
    assert_eq!(block_value(blocks, 0)["type"], "tool_result");
    assert_eq!(
        block_value(blocks, 0)["parentToolUseId"],
        "toolu_parent_agent"
    );
}

#[test]
fn subagent_result_does_not_fire_on_result() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "result", "subtype": "success", "total_cost_usd": 0.001, "parent_tool_use_id": "toolu_task_1", "usage": { "input_tokens": 100, "output_tokens": 50 } }),
    );
    assert_eq!(sink.r().results, 0);
}

#[test]
fn routes_subagent_skill_load_string_command_name() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_dir = tmp.path().join(".claude/skills/pencil");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# Pencil\nbody").unwrap();
    let s = session_at(
        tmp.path().to_str().unwrap(),
        Arc::new(BackgroundTaskTracker::new()),
    );
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "user", "parent_tool_use_id": "toolu_parent_agent", "message": { "role": "user", "content": "<command-name>pencil</command-name>" } }),
    );
    assert!(sink.r().skill_loaded.is_empty());
    let rec = sink.r();
    let (parent, blocks) = &rec.subagent[0];
    assert_eq!(parent, "toolu_parent_agent");
    assert_eq!(block_value(blocks, 0)["type"], "skill_loaded");
    assert_eq!(block_value(blocks, 0)["skillName"], "pencil");
    assert_eq!(
        block_value(blocks, 0)["parentToolUseId"],
        "toolu_parent_agent"
    );
}

#[test]
fn routes_subagent_assistant_events_to_subagent_child_with_tagged_blocks() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({
            "type": "assistant",
            "parent_tool_use_id": "toolu_parent_agent",
            "message": { "role": "assistant", "model": "claude-opus-4-7", "content": [
                { "type": "thinking", "thinking": "subagent inner thought" },
                { "type": "text", "text": "Let me run a command." },
                { "type": "tool_use", "id": "toolu_subagent_bash", "name": "Bash", "input": { "command": "ls" } }
            ] }
        }),
    );
    assert_eq!(sink.r().messages, 0);
    let rec = sink.r();
    assert_eq!(rec.subagent.len(), 1);
    let (parent, blocks) = &rec.subagent[0];
    assert_eq!(parent, "toolu_parent_agent");
    assert_eq!(blocks.len(), 3);
    for i in 0..3 {
        assert_eq!(
            block_value(blocks, i)["parentToolUseId"],
            "toolu_parent_agent"
        );
    }
}

#[test]
fn routes_dispatch_prompt_text_block_to_subagent_child() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({
            "type": "user",
            "parent_tool_use_id": "toolu_parent_agent",
            "message": { "role": "user", "content": [ { "type": "text", "text": "Run `echo hi` via Bash and report the output." } ] }
        }),
    );
    assert!(sink.r().cli_messages.is_empty());
    let rec = sink.r();
    let (parent, blocks) = &rec.subagent[0];
    assert_eq!(parent, "toolu_parent_agent");
    assert_eq!(
        block_value(blocks, 0),
        serde_json::json!({ "type": "text", "text": "Run `echo hi` via Bash and report the output.", "parentToolUseId": "toolu_parent_agent" })
    );
}

#[test]
fn parent_level_null_parent_takes_existing_path() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "user", "parent_tool_use_id": Value::Null, "message": { "role": "user", "content": [ { "type": "text", "text": "Unknown command: /typo" } ] } }),
    );
    assert_eq!(
        sink.r().cli_messages,
        vec!["Unknown command: /typo".to_string()]
    );
    assert!(sink.r().subagent.is_empty());
}
