//! Ported from `packages/core/src/messages/display-pipeline.ts`.
//!
//! Transforms raw `ChatMessage[]` into display-ready `DisplayMessage[]`.
//!
//! CRATE-SPLIT NOTE (PORTING §2.5 amendment): REASSIGNED from mainframe-display to
//! this crate together with `display_helpers` — it composes the Claude-specific
//! grouping/helpers (`group_messages`, `convert_assistant_content`, …) plus the
//! Claude `task_subject_backfill`. See `display_helpers.rs` for the split rationale.

use std::collections::HashSet;

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};
use mainframe_types::content::LeafContent;
use mainframe_types::display::{
    DisplayContent, DisplayMessage, DisplayMessageType, DisplayNode, ToolCategories,
};

use super::display_helpers::{
    apply_tool_grouping, convert_assistant_content, convert_user_content, is_internal_user_message,
    with_parent_id,
};
use super::message_grouping::{GroupedMessage, group_messages};
use super::task_subject_backfill::backfill_task_subjects;

/// Pipeline steps:
/// 1. Filter internal user messages (mainframe commands, skill markers)
/// 2. Group consecutive assistant/tool_use turns, attach tool_results
/// 3. Handle turnDurationMs system markers
/// 4. Convert each grouped message to DisplayMessage
/// 5. Apply tool grouping when categories are provided
pub fn prepare_messages_for_client(
    messages: &[ChatMessage],
    categories: Option<&ToolCategories>,
) -> Vec<DisplayMessage> {
    if messages.is_empty() {
        return Vec::new();
    }

    // Step 1: Filter internal user messages
    let filtered: Vec<ChatMessage> = messages
        .iter()
        .filter(|msg| {
            !(msg.r#type == ChatMessageType::User && is_internal_user_message(&msg.content))
        })
        .cloned()
        .collect();

    // Steps 2–3: Group consecutive assistant turns, attach tool_results,
    // handle turnDurationMs (all handled by group_messages)
    let grouped = group_messages(filtered);

    // Steps 4–5: Convert to DisplayMessage, deduplicating by id. The CLI can reuse
    // UUIDs (e.g. compact_boundary entries), which crashes assistant-ui's
    // MessageRepository on duplicate ids.
    let mut result: Vec<DisplayMessage> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    for g_msg in &grouped {
        let display = match convert_grouped_to_display(g_msg, categories) {
            Some(d) => d,
            None => continue,
        };
        if seen_ids.contains(&display.id) {
            continue;
        }
        seen_ids.insert(display.id.clone());
        result.push(display);
    }

    // Cross-message pass: name TaskUpdate items whose TaskCreate lives in an
    // earlier grouped message (the CLI's update events carry no subject).
    backfill_task_subjects(&result)
}

fn convert_grouped_to_display(
    msg: &GroupedMessage,
    categories: Option<&ToolCategories>,
) -> Option<DisplayMessage> {
    let id = msg.base.id.clone();
    let chat_id = msg.base.chat_id.clone();
    let timestamp = msg.base.timestamp.clone();

    match msg.base.r#type {
        ChatMessageType::Assistant | ChatMessageType::ToolUse => {
            let mut content = convert_assistant_content(msg, categories);
            if let Some(cats) = categories {
                content = apply_tool_grouping(content, cats);
            }
            Some(DisplayMessage {
                id,
                chat_id,
                r#type: DisplayMessageType::Assistant,
                content,
                timestamp,
                metadata: msg.base.metadata.clone(),
            })
        }

        ChatMessageType::User => {
            let (display_content, extra_meta) = convert_user_content(&msg.base.content);
            // Suppress user messages whose entire content was stripped to nothing
            // (bare <command-name> CLI echoes with no visible text/images/results).
            if display_content.is_empty() && extra_meta.is_empty() {
                return None;
            }
            let mut metadata = msg.base.metadata.clone().unwrap_or_default();
            metadata.extend(extra_meta);
            Some(DisplayMessage {
                id,
                chat_id,
                r#type: DisplayMessageType::User,
                content: display_content,
                timestamp,
                metadata: if metadata.is_empty() {
                    None
                } else {
                    Some(metadata)
                },
            })
        }

        ChatMessageType::System => Some(DisplayMessage {
            id,
            chat_id,
            r#type: DisplayMessageType::System,
            content: msg
                .base
                .content
                .iter()
                .map(|c| match c {
                    MessageContent::Leaf(LeafContent::Text {
                        text,
                        parent_tool_use_id,
                    }) => DisplayContent::Leaf(LeafContent::Text {
                        text: text.clone(),
                        parent_tool_use_id: with_parent_id(parent_tool_use_id),
                    }),
                    MessageContent::Leaf(LeafContent::SkillLoaded {
                        skill_name,
                        path,
                        content,
                        parent_tool_use_id,
                    }) => DisplayContent::Leaf(LeafContent::SkillLoaded {
                        skill_name: skill_name.clone(),
                        path: path.clone(),
                        content: content.clone(),
                        parent_tool_use_id: with_parent_id(parent_tool_use_id),
                    }),
                    MessageContent::Node(MessageContentNode::Compaction { .. }) => {
                        DisplayContent::Node(DisplayNode::Compaction {
                            parent_tool_use_id: None,
                        })
                    }
                    _ => empty_text(),
                })
                .collect(),
            timestamp,
            metadata: msg.base.metadata.clone(),
        }),

        ChatMessageType::Error => Some(DisplayMessage {
            id,
            chat_id,
            r#type: DisplayMessageType::Error,
            content: msg
                .base
                .content
                .iter()
                .map(|c| match c {
                    MessageContent::Node(MessageContentNode::Error { message, .. }) => {
                        DisplayContent::Node(DisplayNode::Error {
                            message: message.clone(),
                        })
                    }
                    _ => empty_text(),
                })
                .collect(),
            timestamp,
            metadata: msg.base.metadata.clone(),
        }),

        ChatMessageType::Permission => Some(DisplayMessage {
            id,
            chat_id,
            r#type: DisplayMessageType::Permission,
            content: msg
                .base
                .content
                .iter()
                .map(|c| match c {
                    MessageContent::Node(MessageContentNode::PermissionRequest {
                        request, ..
                    }) => DisplayContent::Node(DisplayNode::PermissionRequest {
                        request: request.clone(),
                        parent_tool_use_id: None,
                    }),
                    _ => empty_text(),
                })
                .collect(),
            timestamp,
            metadata: msg.base.metadata.clone(),
        }),

        // Orphan tool_result without a preceding assistant/tool_use — suppress.
        ChatMessageType::ToolResult => None,
    }
}

fn empty_text() -> DisplayContent {
    DisplayContent::Leaf(LeafContent::Text {
        text: String::new(),
        parent_tool_use_id: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn txt(t: &str) -> Value {
        json!({ "type": "text", "text": t })
    }
    fn tu(id: &str, name: &str, input: Value) -> Value {
        json!({ "type": "tool_use", "id": id, "name": name, "input": input })
    }
    fn tr(tool_use_id: &str, content: &str, is_error: bool) -> Value {
        json!({ "type": "tool_result", "toolUseId": tool_use_id, "content": content, "isError": is_error })
    }

    fn raw_msg(counter: &mut i64, t: &str, content: Vec<Value>, overrides: Value) -> ChatMessage {
        *counter += 1;
        let mut obj = json!({
            "id": format!("msg-{}", *counter),
            "chatId": "chat-1",
            "type": t,
            "content": content,
            "timestamp": format!("2026-01-01T00:00:{:02}.000Z", *counter),
        });
        if let (Value::Object(map), Value::Object(over)) = (&mut obj, overrides) {
            for (k, v) in over {
                map.insert(k, v);
            }
        }
        serde_json::from_value(obj).unwrap()
    }

    fn test_categories() -> ToolCategories {
        serde_json::from_value(json!({
            "explore": ["Read", "Glob", "Grep"],
            "hidden": ["TodoWrite", "Skill"],
            "progress": ["TaskCreate", "TaskUpdate"],
            "subagent": ["Task"],
        }))
        .unwrap()
    }

    fn content_json(m: &DisplayMessage) -> Value {
        serde_json::to_value(&m.content).unwrap()
    }

    #[test]
    fn returns_empty_array_for_empty_input() {
        assert!(prepare_messages_for_client(&[], None).is_empty());
    }

    #[test]
    fn converts_a_single_user_text_message() {
        let mut c = 0;
        let messages = vec![raw_msg(&mut c, "user", vec![txt("hello")], json!({}))];
        let result = prepare_messages_for_client(&messages, None);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].r#type, DisplayMessageType::User);
        assert_eq!(
            content_json(&result[0]),
            json!([{ "type": "text", "text": "hello" }])
        );
    }

    #[test]
    fn converts_a_single_assistant_text_message() {
        let mut c = 0;
        let messages = vec![raw_msg(
            &mut c,
            "assistant",
            vec![txt("hi there")],
            json!({}),
        )];
        let result = prepare_messages_for_client(&messages, None);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].r#type, DisplayMessageType::Assistant);
        assert_eq!(
            content_json(&result[0]),
            json!([{ "type": "text", "text": "hi there" }])
        );
    }

    #[test]
    fn converts_assistant_tool_use_plus_tool_result_into_tool_call_with_result() {
        let mut c = 0;
        let messages = vec![
            raw_msg(
                &mut c,
                "assistant",
                vec![
                    txt("Let me check"),
                    tu("tu1", "Bash", json!({ "command": "ls" })),
                ],
                json!({}),
            ),
            raw_msg(
                &mut c,
                "tool_result",
                vec![tr("tu1", "file.ts\nindex.ts", false)],
                json!({}),
            ),
        ];
        let result = prepare_messages_for_client(&messages, None);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].r#type, DisplayMessageType::Assistant);
        let content = content_json(&result[0]);
        assert_eq!(content.as_array().unwrap().len(), 2);
        assert_eq!(
            content[0],
            json!({ "type": "text", "text": "Let me check" })
        );
        assert_eq!(content[1]["type"], "tool_call");
        assert_eq!(content[1]["id"], "tu1");
        assert_eq!(content[1]["name"], "Bash");
        assert_eq!(content[1]["input"], json!({ "command": "ls" }));
        assert_eq!(content[1]["category"], "default");
        assert_eq!(
            content[1]["result"],
            json!({ "content": "file.ts\nindex.ts", "isError": false })
        );
    }

    #[test]
    fn merges_consecutive_assistant_messages_into_one_turn() {
        let mut c = 0;
        let messages = vec![
            raw_msg(&mut c, "assistant", vec![txt("part 1")], json!({})),
            raw_msg(&mut c, "assistant", vec![txt("part 2")], json!({})),
        ];
        let result = prepare_messages_for_client(&messages, None);
        assert_eq!(result.len(), 1);
        assert_eq!(
            content_json(&result[0]),
            json!([{ "type": "text", "text": "part 1" }, { "type": "text", "text": "part 2" }])
        );
    }

    #[test]
    fn strips_mainframe_command_response_tags_from_assistant_text() {
        let mut c = 0;
        let messages = vec![raw_msg(
            &mut c,
            "assistant",
            vec![txt(
                "<mainframe-command-response id=\"x\">inner content</mainframe-command-response>",
            )],
            json!({}),
        )];
        let result = prepare_messages_for_client(&messages, None);
        assert_eq!(result.len(), 1);
        assert_eq!(
            content_json(&result[0])[0],
            json!({ "type": "text", "text": "inner content" })
        );
    }

    #[test]
    fn filters_out_internal_user_messages_with_mainframe_command() {
        let mut c = 0;
        let messages = vec![
            raw_msg(
                &mut c,
                "user",
                vec![txt(
                    "<mainframe-command type=\"status\">check</mainframe-command>",
                )],
                json!({}),
            ),
            raw_msg(&mut c, "assistant", vec![txt("response")], json!({})),
        ];
        let result = prepare_messages_for_client(&messages, None);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].r#type, DisplayMessageType::Assistant);
    }

    #[test]
    fn renders_user_typed_slash_skill_name_as_a_bubble() {
        let mut c = 0;
        let messages = vec![
            raw_msg(
                &mut c,
                "user",
                vec![txt(
                    "<command-message>systematic-debugging</command-message>\n<command-name>/systematic-debugging</command-name>",
                )],
                json!({}),
            ),
            raw_msg(&mut c, "assistant", vec![txt("response")], json!({})),
        ];
        let result = prepare_messages_for_client(&messages, None);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].r#type, DisplayMessageType::User);
        assert_eq!(
            content_json(&result[0]),
            json!([{ "type": "text", "text": "/systematic-debugging" }])
        );
    }

    #[test]
    fn renders_user_typed_slash_skill_name_with_args() {
        let mut c = 0;
        let messages = vec![raw_msg(
            &mut c,
            "user",
            vec![txt(
                "<command-message>work-logger:slack-status-writer</command-message>\n<command-name>/work-logger:slack-status-writer</command-name>\n<command-args>how are you</command-args>",
            )],
            json!({}),
        )];
        let result = prepare_messages_for_client(&messages, None);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].r#type, DisplayMessageType::User);
        assert_eq!(
            content_json(&result[0]),
            json!([{ "type": "text", "text": "/work-logger:slack-status-writer how are you" }])
        );
    }

    #[test]
    fn deduplicates_tool_use_blocks_by_id() {
        let mut c = 0;
        let messages = vec![raw_msg(
            &mut c,
            "assistant",
            vec![
                tu("tu1", "Bash", json!({ "command": "ls" })),
                tu("tu1", "Bash", json!({ "command": "ls" })),
                tu("tu2", "Read", json!({ "file": "/a.ts" })),
            ],
            json!({}),
        )];
        let result = prepare_messages_for_client(&messages, None);
        let tool_calls = content_json(&result[0])
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["type"] == "tool_call")
            .count();
        assert_eq!(tool_calls, 2);
    }

    #[test]
    fn passes_through_system_compact_boundary() {
        let mut c = 0;
        let messages = vec![raw_msg(
            &mut c,
            "system",
            vec![txt("[compact_boundary]")],
            json!({}),
        )];
        let result = prepare_messages_for_client(&messages, None);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].r#type, DisplayMessageType::System);
        assert_eq!(
            content_json(&result[0]),
            json!([{ "type": "text", "text": "[compact_boundary]" }])
        );
    }

    #[test]
    fn deduplicates_messages_with_the_same_id() {
        let mut c = 0;
        let messages = vec![
            raw_msg(&mut c, "user", vec![txt("hello")], json!({})),
            raw_msg(&mut c, "assistant", vec![txt("hi")], json!({})),
            raw_msg(
                &mut c,
                "system",
                vec![txt("Context compacted")],
                json!({ "id": "dup-id" }),
            ),
            raw_msg(&mut c, "user", vec![txt("more")], json!({})),
            raw_msg(
                &mut c,
                "system",
                vec![txt("Context compacted")],
                json!({ "id": "dup-id" }),
            ),
        ];
        let result = prepare_messages_for_client(&messages, None);
        let system_msgs = result
            .iter()
            .filter(|m| m.r#type == DisplayMessageType::System)
            .count();
        assert_eq!(system_msgs, 1);
        assert_eq!(result.len(), 4);
    }

    #[test]
    fn passes_through_error_messages() {
        let mut c = 0;
        let messages = vec![raw_msg(
            &mut c,
            "error",
            vec![json!({ "type": "error", "message": "something broke" })],
            json!({}),
        )];
        let result = prepare_messages_for_client(&messages, None);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].r#type, DisplayMessageType::Error);
        assert_eq!(
            content_json(&result[0]),
            json!([{ "type": "error", "message": "something broke" }])
        );
    }

    #[test]
    fn attaches_turn_duration_ms_to_preceding_assistant() {
        let mut c = 0;
        let messages = vec![
            raw_msg(&mut c, "assistant", vec![txt("answer")], json!({})),
            raw_msg(
                &mut c,
                "system",
                vec![],
                json!({ "metadata": { "turnDurationMs": 1234 } }),
            ),
        ];
        let result = prepare_messages_for_client(&messages, None);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].r#type, DisplayMessageType::Assistant);
        assert_eq!(
            result[0]
                .metadata
                .as_ref()
                .and_then(|m| m.get("turnDurationMs")),
            Some(&json!(1234))
        );
    }

    #[test]
    fn applies_tool_categories_explore_tool_gets_explore_category() {
        let mut c = 0;
        let messages = vec![
            raw_msg(
                &mut c,
                "assistant",
                vec![tu("tu1", "Read", json!({ "file": "/a.ts" }))],
                json!({}),
            ),
            raw_msg(
                &mut c,
                "tool_result",
                vec![tr("tu1", "content", false)],
                json!({}),
            ),
        ];
        let cats = test_categories();
        let result = prepare_messages_for_client(&messages, Some(&cats));
        let tc = content_json(&result[0])
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["type"] == "tool_call")
            .cloned()
            .unwrap();
        assert_eq!(tc["category"], "explore");
    }

    #[test]
    fn passes_through_permission_messages() {
        let mut c = 0;
        let request = json!({
            "requestId": "req_1",
            "toolName": "Bash",
            "toolUseId": "tu_1",
            "input": { "command": "ls" },
            "suggestions": [],
        });
        let messages = vec![raw_msg(
            &mut c,
            "permission",
            vec![json!({ "type": "permission_request", "request": request })],
            json!({}),
        )];
        let result = prepare_messages_for_client(&messages, None);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].r#type, DisplayMessageType::Permission);
        assert_eq!(content_json(&result[0])[0]["type"], "permission_request");
    }

    #[test]
    fn filters_request_interrupted_text_from_user_messages() {
        let mut c = 0;
        let messages = vec![raw_msg(
            &mut c,
            "user",
            vec![txt("fix the bug"), txt("[Request interrupted by user]")],
            json!({}),
        )];
        let result = prepare_messages_for_client(&messages, None);
        assert_eq!(result.len(), 1);
        assert_eq!(
            content_json(&result[0]),
            json!([{ "type": "text", "text": "fix the bug" }])
        );
    }

    #[test]
    fn populates_metadata_attached_files_for_file_path_tags() {
        let mut c = 0;
        let messages = vec![raw_msg(
            &mut c,
            "user",
            vec![txt("check this <attached_file_path name=\"foo.ts\"/>")],
            json!({}),
        )];
        let result = prepare_messages_for_client(&messages, None);
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0]
                .metadata
                .as_ref()
                .and_then(|m| m.get("attachedFiles")),
            Some(&json!([{ "name": "foo.ts" }]))
        );
        assert_eq!(content_json(&result[0])[0]["text"], "check this");
    }

    #[test]
    fn does_not_mutate_original_messages() {
        let mut c = 0;
        let original = raw_msg(
            &mut c,
            "assistant",
            vec![tu("tu1", "Bash", json!({ "command": "ls" }))],
            json!({}),
        );
        let original_before = original.clone();
        let messages = vec![
            original,
            raw_msg(&mut c, "assistant", vec![txt("more")], json!({})),
            raw_msg(
                &mut c,
                "tool_result",
                vec![tr("tu1", "output", false)],
                json!({}),
            ),
            raw_msg(
                &mut c,
                "system",
                vec![],
                json!({ "metadata": { "turnDurationMs": 100 } }),
            ),
        ];
        prepare_messages_for_client(&messages, None);
        assert_eq!(messages[0], original_before);
    }

    #[test]
    fn keeps_thinking_blocks_as_is_in_assistant_messages() {
        let mut c = 0;
        let messages = vec![raw_msg(
            &mut c,
            "assistant",
            vec![
                json!({ "type": "thinking", "thinking": "let me think..." }),
                txt("response"),
            ],
            json!({}),
        )];
        let result = prepare_messages_for_client(&messages, None);
        let content = content_json(&result[0]);
        assert_eq!(
            content[0],
            json!({ "type": "thinking", "thinking": "let me think..." })
        );
        assert_eq!(content[1], json!({ "type": "text", "text": "response" }));
    }

    #[test]
    fn keeps_image_blocks_in_assistant_messages() {
        let mut c = 0;
        let messages = vec![raw_msg(
            &mut c,
            "assistant",
            vec![
                txt("here is your image"),
                json!({ "type": "image", "mediaType": "image/png", "data": "pngbase64" }),
            ],
            json!({}),
        )];
        let result = prepare_messages_for_client(&messages, None);
        let content = content_json(&result[0]);
        assert_eq!(content.as_array().unwrap().len(), 2);
        assert_eq!(
            content[1],
            json!({ "type": "image", "mediaType": "image/png", "data": "pngbase64" })
        );
    }

    #[test]
    fn keeps_image_blocks_in_user_messages() {
        let mut c = 0;
        let messages = vec![raw_msg(
            &mut c,
            "user",
            vec![
                txt("look at this"),
                json!({ "type": "image", "mediaType": "image/png", "data": "base64data" }),
            ],
            json!({}),
        )];
        let result = prepare_messages_for_client(&messages, None);
        let content = content_json(&result[0]);
        assert_eq!(content.as_array().unwrap().len(), 2);
        assert_eq!(
            content[1],
            json!({ "type": "image", "mediaType": "image/png", "data": "base64data" })
        );
    }

    #[test]
    fn suppresses_orphan_tool_result() {
        let mut c = 0;
        let messages = vec![
            raw_msg(&mut c, "user", vec![txt("question")], json!({})),
            raw_msg(
                &mut c,
                "tool_result",
                vec![tr("tu1", "orphan result", false)],
                json!({}),
            ),
        ];
        let result = prepare_messages_for_client(&messages, None);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].r#type, DisplayMessageType::User);
    }

    #[test]
    fn suppresses_a_bare_command_name_message_with_no_body() {
        let mut c = 0;
        let messages = vec![
            raw_msg(
                &mut c,
                "user",
                vec![txt("<command-name>do-thing</command-name>")],
                json!({}),
            ),
            raw_msg(&mut c, "assistant", vec![txt("response")], json!({})),
        ];
        let result = prepare_messages_for_client(&messages, None);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].r#type, DisplayMessageType::Assistant);
    }

    #[test]
    fn suppresses_a_command_name_with_empty_body_after_stripping() {
        let mut c = 0;
        let messages = vec![raw_msg(
            &mut c,
            "user",
            vec![txt("<command-name>/some-internal-skill</command-name>")],
            json!({}),
        )];
        let result = prepare_messages_for_client(&messages, None);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn still_renders_user_typed_skill_name_with_command_message() {
        let mut c = 0;
        let messages = vec![
            raw_msg(
                &mut c,
                "user",
                vec![txt(
                    "<command-message>systematic-debugging</command-message>\n<command-name>/systematic-debugging</command-name>",
                )],
                json!({}),
            ),
            raw_msg(&mut c, "assistant", vec![txt("response")], json!({})),
        ];
        let result = prepare_messages_for_client(&messages, None);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].r#type, DisplayMessageType::User);
        assert_eq!(
            content_json(&result[0]),
            json!([{ "type": "text", "text": "/systematic-debugging" }])
        );
    }

    #[test]
    fn still_renders_user_typed_skill_name_args_bubble_when_command_message_present() {
        let mut c = 0;
        let messages = vec![raw_msg(
            &mut c,
            "user",
            vec![txt(
                "<command-message>brainstorming</command-message>\n<command-name>/brainstorming</command-name>\n<command-args>new feature idea</command-args>",
            )],
            json!({}),
        )];
        let result = prepare_messages_for_client(&messages, None);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].r#type, DisplayMessageType::User);
        assert_eq!(
            content_json(&result[0]),
            json!([{ "type": "text", "text": "/brainstorming new feature idea" }])
        );
    }

    #[test]
    fn groups_consecutive_explore_tools_into_a_tool_group() {
        let mut c = 0;
        let messages = vec![
            raw_msg(
                &mut c,
                "assistant",
                vec![
                    tu("tu1", "Read", json!({ "file": "/a.ts" })),
                    tu("tu2", "Grep", json!({ "pattern": "foo" })),
                    tu("tu3", "Glob", json!({ "pattern": "*.ts" })),
                ],
                json!({}),
            ),
            raw_msg(
                &mut c,
                "tool_result",
                vec![
                    tr("tu1", "a-content", false),
                    tr("tu2", "grep-result", false),
                    tr("tu3", "glob-result", false),
                ],
                json!({}),
            ),
        ];
        let cats = test_categories();
        let result = prepare_messages_for_client(&messages, Some(&cats));
        let groups = content_json(&result[0])
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["type"] == "tool_group")
            .count();
        assert_eq!(groups, 1);
    }

    #[test]
    fn wraps_subagent_tool_plus_tagged_children_into_a_task_group() {
        let mut c = 0;
        let messages = vec![
            raw_msg(
                &mut c,
                "assistant",
                vec![
                    tu("tu1", "Task", json!({ "description": "do something" })),
                    json!({ "type": "tool_use", "id": "tu2", "name": "Bash", "input": { "command": "ls" }, "parentToolUseId": "tu1" }),
                ],
                json!({}),
            ),
            raw_msg(
                &mut c,
                "tool_result",
                vec![
                    tr("tu1", "task-result", false),
                    tr("tu2", "bash-result", false),
                ],
                json!({}),
            ),
        ];
        let cats = test_categories();
        let result = prepare_messages_for_client(&messages, Some(&cats));
        let task_groups = content_json(&result[0])
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["type"] == "task_group")
            .count();
        assert_eq!(task_groups, 1);
    }

    #[test]
    fn preserves_thinking_block_position_among_grouped_tool_calls() {
        let mut c = 0;
        let messages = vec![
            raw_msg(
                &mut c,
                "assistant",
                vec![
                    txt("Let me think"),
                    json!({ "type": "thinking", "thinking": "reasoning here" }),
                    tu("tu1", "Read", json!({ "file_path": "a.ts" })),
                    tu("tu2", "Read", json!({ "file_path": "b.ts" })),
                    tu("tu3", "Bash", json!({ "command": "ls" })),
                ],
                json!({}),
            ),
            raw_msg(
                &mut c,
                "tool_result",
                vec![
                    tr("tu1", "content-a", false),
                    tr("tu2", "content-b", false),
                    tr("tu3", "ls-output", false),
                ],
                json!({}),
            ),
        ];
        let cats = test_categories();
        let result = prepare_messages_for_client(&messages, Some(&cats));
        let content = content_json(&result[0]);
        let types: Vec<String> = content
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["type"].as_str().unwrap().to_string())
            .collect();
        let thinking_idx = types.iter().position(|t| t == "thinking").unwrap();
        let text_idx = types.iter().position(|t| t == "text").unwrap();
        assert!(thinking_idx > text_idx);
        assert_ne!(thinking_idx, 0);
    }
}

// PORT STATUS: src/messages/display-pipeline.ts (152 lines)
// confidence: high
// todos: 0
// notes: REASSIGNED from mainframe-display → mainframe-adapter-claude (§2.5 amendment;
// notes: see display_helpers.rs). Takes messages by &[ChatMessage] and clones the
// notes: filtered set into group_messages (which owns its Vec), so originals are never
// notes: mutated (the TS "does not mutate" invariant holds by construction). System
// notes: content maps text/skill_loaded/compaction; error → Error; permission →
// notes: PermissionRequest (parentToolUseId dropped, matching the TS `{type,request}`
// notes: / `{type:'compaction'}` literals). All ~30 display-pipeline.test.ts cases
// notes: ported (asserted against serde_json Values to mirror the TS deep-equality).
