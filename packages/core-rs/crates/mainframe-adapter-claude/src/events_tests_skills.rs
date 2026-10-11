use super::*;
#[test]
fn skill_tool_use_without_name_does_not_fire_skill_file() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({
            "type": "assistant",
            "message": { "role": "assistant", "content": [
                { "type": "tool_use", "id": "toolu_002", "name": "Skill", "input": {} }
            ] }
        }),
    );
    assert!(sink.r().skill_files.is_empty());
}

#[test]
fn user_event_skill_format_strips_markers_from_content() {
    let s = session();
    let sink = RecordingSink::default();
    let text = "<command-name>brainstorming</command-name>\n<skill-format>true</skill-format>\nBase directory for this skill: /home/user/.claude/skills/brainstorming\n# brainstorming\n\nThink broadly.";
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "user", "message": { "role": "user", "content": [ { "type": "text", "text": text } ] } }),
    );
    assert!(sink.r().cli_messages.is_empty());
    let loaded = &sink.r().skill_loaded[0];
    assert_eq!(loaded.skill_name, "brainstorming");
    assert_eq!(
        loaded.path,
        "/home/user/.claude/skills/brainstorming/SKILL.md"
    );
    assert!(loaded.content.contains("# brainstorming"));
    assert!(!loaded.content.contains("<command-name>"));
    assert!(!loaded.content.contains("<skill-format>"));
    assert!(!loaded.content.contains("Base directory for this skill:"));
}

#[test]
fn user_typed_skill_without_skill_format_tag() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({
            "type": "user",
            "isMeta": true,
            "message": { "role": "user", "content": [
                { "type": "text", "text": "Base directory for this skill: /Users/me/.claude/plugins/cache/marketplace/work-logger/2.0.0/skills/slack-status-writer\n\n# Slack Status Writer\n\nBody." }
            ] }
        }),
    );
    assert_eq!(
        sink.r().skill_files[0].path,
        "/Users/me/.claude/plugins/cache/marketplace/work-logger/2.0.0/skills/slack-status-writer/SKILL.md"
    );
    assert_eq!(sink.r().skill_files[0].display_name, "slack-status-writer");
}

#[test]
fn user_is_meta_text_skill_injection_fires_skill_file_and_loaded() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({
            "type": "user",
            "isMeta": true,
            "message": { "role": "user", "content": [
                { "type": "text", "text": "<command-name>foo</command-name>\n<skill-format>true</skill-format>\n\nBase directory for this skill: /home/user/.claude/skills/foo\n\n# Foo skill body" }
            ] }
        }),
    );
    assert_eq!(
        sink.r().skill_files[0].path,
        "/home/user/.claude/skills/foo/SKILL.md"
    );
    assert_eq!(sink.r().skill_files[0].display_name, "foo");
    assert_eq!(sink.r().skill_loaded[0].skill_name, "foo");
    assert_eq!(
        sink.r().skill_loaded[0].path,
        "/home/user/.claude/skills/foo/SKILL.md"
    );
}

#[test]
fn detects_model_initiated_skill_and_resolves_path() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_dir = tmp.path().join(".claude/skills/brainstorming");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# brainstorming").unwrap();
    let s = session_at(
        tmp.path().to_str().unwrap(),
        Arc::new(BackgroundTaskTracker::new()),
    );
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({
            "type": "assistant",
            "message": { "model": "claude", "content": [
                { "type": "tool_use", "id": "toolu_1", "name": "Skill", "input": { "skill": "brainstorming" } }
            ] }
        }),
    );
    let files = &sink.r().skill_files;
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, skill_dir.join("SKILL.md").to_string_lossy());
    assert_eq!(files[0].display_name, "brainstorming");
}

#[test]
fn non_skill_cli_text_still_fires_cli_message() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "user", "message": { "role": "user", "content": [ { "type": "text", "text": "Unknown command: /typo. Did you mean /brainstorming?" } ] } }),
    );
    assert_eq!(
        sink.r().cli_messages,
        vec!["Unknown command: /typo. Did you mean /brainstorming?".to_string()]
    );
    assert!(sink.r().skill_loaded.is_empty());
}

#[test]
fn falls_back_to_home_skills_convention() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({
            "type": "assistant",
            "message": { "model": "claude", "content": [
                { "type": "tool_use", "id": "toolu_2", "name": "Skill", "input": { "skill": "__definitely-not-installed" } }
            ] }
        }),
    );
    let expected = dirs::home_dir()
        .unwrap()
        .join(".claude/skills/__definitely-not-installed/SKILL.md")
        .to_string_lossy()
        .to_string();
    assert_eq!(sink.r().skill_files[0].path, expected);
}
