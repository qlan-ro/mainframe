//! Ported from `packages/core/src/plugins/builtin/claude/history-converters.ts`.
//!
//! Converts raw Claude JSONL entries (`Record<string, unknown>` → here
//! `serde_json::Value`) into transcript `ChatMessage`s: user/assistant/queued-
//! command entries plus synthesized skill-loaded / unknown-command messages.

use std::collections::HashMap;
use std::path::Path;

use mainframe_runtime::time::now_iso8601;
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};
use mainframe_types::content::LeafContent;
use serde_json::Value;

use crate::history_tool_result::{build_tool_result_blocks, js_truthy};

// ── id / timestamp helpers ──────────────────────────────────────────────────

/// `entry.uuid || nanoid()` — falls back on absent OR empty string.
fn id_or_nanoid(entry: &Value) -> String {
    entry
        .get("uuid")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| nanoid::nanoid!())
}

/// `entry.uuid ?? nanoid()` — falls back only on absent/null (keeps "").
fn uuid_or_nanoid_nullish(entry: &Value) -> String {
    entry
        .get("uuid")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| nanoid::nanoid!())
}

/// `entry.timestamp || new Date().toISOString()`.
fn timestamp_or_now(entry: &Value) -> String {
    entry
        .get("timestamp")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(now_iso8601)
}

/// `entry.timestamp ?? new Date().toISOString()`.
fn timestamp_or_now_nullish(entry: &Value) -> String {
    entry
        .get("timestamp")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(now_iso8601)
}

fn history_meta() -> HashMap<String, Value> {
    let mut m = HashMap::new();
    m.insert("source".to_string(), Value::String("history".to_string()));
    m
}

// ── synthesizers ────────────────────────────────────────────────────────────

/// "Unknown command: /X" user entries are CLI feedback — synthesize the
/// invocation bubble + the error pill so history mirrors what the user saw live.
pub fn synthesize_unknown_command_from_user_entry(
    entry: &Value,
    chat_id: &str,
) -> Option<Vec<ChatMessage>> {
    let content = entry.get("message").and_then(|m| m.get("content"))?;
    let content = content.as_str()?; // typeof content !== 'string' → null
    // /^Unknown (?:command|skill):\s+\/?(\S+)/ on content.trim()
    let name = match_unknown_command(content.trim())?;
    let cmd = format!("/{name}");
    let uuid = uuid_or_nanoid_nullish(entry);
    let timestamp = timestamp_or_now_nullish(entry);
    Some(vec![
        ChatMessage {
            id: format!("unknown-cmd-user-{uuid}"),
            chat_id: chat_id.to_string(),
            r#type: ChatMessageType::User,
            content: vec![text_block(cmd)],
            timestamp: timestamp.clone(),
            metadata: None,
        },
        ChatMessage {
            id: format!("unknown-cmd-err-{uuid}"),
            chat_id: chat_id.to_string(),
            r#type: ChatMessageType::System,
            content: vec![text_block(content.trim().to_string())],
            timestamp,
            metadata: None,
        },
    ])
}

/// `^Unknown (?:command|skill):\s+\/?(\S+)` — returns group 1 (the name).
fn match_unknown_command(t: &str) -> Option<String> {
    let rest = t
        .strip_prefix("Unknown command:")
        .or_else(|| t.strip_prefix("Unknown skill:"))?;
    // \s+
    let ws: usize = rest.chars().take_while(|c| c.is_whitespace()).count();
    if ws == 0 {
        return None;
    }
    let ws_bytes: usize = rest.chars().take(ws).map(char::len_utf8).sum();
    let mut after = &rest[ws_bytes..];
    // \/?
    if let Some(s) = after.strip_prefix('/') {
        after = s;
    }
    // (\S+)
    let name: String = after.chars().take_while(|c| !c.is_whitespace()).collect();
    if name.is_empty() { None } else { Some(name) }
}

pub fn synthesize_skill_loaded_from_user_entry(
    entry: &Value,
    chat_id: &str,
) -> Option<ChatMessage> {
    let content = entry.get("message").and_then(|m| m.get("content"))?;
    let arr = content.as_array()?;
    if arr.is_empty() {
        return None;
    }
    let first = &arr[0];
    if first.get("type").and_then(Value::as_str) != Some("text") {
        return None;
    }
    let text = first.get("text").and_then(Value::as_str)?;
    // /^Base directory for this skill:\s*(.+?)(?:\n|$)/m
    let base_dir = match_base_dir(text)?;
    let base_dir = base_dir.trim();
    let skill_name = Path::new(base_dir)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let skill_path = if Path::new(base_dir).extension().is_some() {
        base_dir.to_string()
    } else {
        Path::new(base_dir)
            .join("SKILL.md")
            .to_string_lossy()
            .to_string()
    };
    let skill_content = strip_base_dir_line(text).trim().to_string();
    let uuid = uuid_or_nanoid_nullish(entry);
    Some(ChatMessage {
        id: format!("skill-loaded-{uuid}"),
        chat_id: chat_id.to_string(),
        r#type: ChatMessageType::System,
        content: vec![MessageContent::Leaf(LeafContent::SkillLoaded {
            skill_name,
            path: skill_path,
            content: skill_content,
            parent_tool_use_id: None,
        })],
        timestamp: timestamp_or_now_nullish(entry),
        metadata: None,
    })
}

/// The line-start byte index of "Base directory for this skill:" (`^…/m`).
fn base_dir_line_start(text: &str) -> Option<usize> {
    const LIT: &str = "Base directory for this skill:";
    let mut search_from = 0;
    while let Some(rel) = text[search_from..].find(LIT) {
        let idx = search_from + rel;
        if idx == 0 || text.as_bytes()[idx - 1] == b'\n' {
            return Some(idx);
        }
        search_from = idx + LIT.len();
    }
    None
}

/// `^Base directory for this skill:\s*(.+?)(?:\n|$)/m` group 1.
fn match_base_dir(text: &str) -> Option<String> {
    const LIT: &str = "Base directory for this skill:";
    let start = base_dir_line_start(text)?;
    let after = &text[start + LIT.len()..];
    // \s* (includes newlines)
    let ws_chars: usize = after.chars().take_while(|c| c.is_whitespace()).count();
    let ws_bytes: usize = after.chars().take(ws_chars).map(char::len_utf8).sum();
    let rest = &after[ws_bytes..];
    // (.+?)(?:\n|$) — at least one non-newline char up to the newline/end.
    let captured: String = rest.chars().take_while(|&c| c != '\n').collect();
    if captured.is_empty() {
        None
    } else {
        Some(captured)
    }
}

/// Remove the first `^Base directory for this skill:[^\n]*\n?/m` line.
fn strip_base_dir_line(text: &str) -> String {
    const LIT: &str = "Base directory for this skill:";
    let Some(start) = base_dir_line_start(text) else {
        return text.to_string();
    };
    let after = start + LIT.len();
    // [^\n]* then \n?
    let line_end = text[after..]
        .find('\n')
        .map(|k| after + k + 1) // consume the newline (\n?)
        .unwrap_or(text.len());
    let mut out = String::with_capacity(text.len());
    out.push_str(&text[..start]);
    out.push_str(&text[line_end..]);
    out
}

// ── content extraction ──────────────────────────────────────────────────────

pub struct ExtractOpts {
    pub skip_interrupted: bool,
}

/// Extract text/image blocks from a raw user-role block array.
pub fn extract_user_content_blocks(blocks: &[Value], opts: &ExtractOpts) -> Vec<MessageContent> {
    let mut result: Vec<MessageContent> = Vec::new();
    for block in blocks {
        let btype = block.get("type").and_then(Value::as_str);
        if btype == Some("text") {
            let text = block.get("text").and_then(Value::as_str);
            if opts.skip_interrupted {
                let t = text.unwrap_or("");
                if !t.starts_with("[Request interrupted") {
                    result.push(text_block(t.to_string()));
                }
            } else if let Some(t) = text
                && !t.trim().is_empty()
            {
                result.push(text_block(t.to_string()));
            }
        } else if btype == Some("image")
            && let Some(source) = block.get("source")
            && source.get("type").and_then(Value::as_str) == Some("base64")
        {
            result.push(MessageContent::Leaf(LeafContent::Image {
                media_type: source
                    .get("media_type")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                data: source
                    .get("data")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                parent_tool_use_id: None,
            }));
        }
    }
    result
}

fn text_block(text: String) -> MessageContent {
    MessageContent::Leaf(LeafContent::Text {
        text,
        parent_tool_use_id: None,
    })
}

fn value_object_to_map(v: Option<&Value>) -> HashMap<String, Value> {
    match v.and_then(Value::as_object) {
        Some(obj) => obj
            .iter()
            .map(|(k, val)| (k.clone(), val.clone()))
            .collect(),
        None => HashMap::new(),
    }
}

// ── entry converters ────────────────────────────────────────────────────────

fn convert_user_entry(entry: &Value, message: &Value, chat_id: &str) -> Option<ChatMessage> {
    let raw_content = message.get("content");
    let mut content_blocks: Vec<MessageContent> = Vec::new();
    let tool_use_result = entry.get("toolUseResult");

    match raw_content {
        Some(Value::String(s)) => {
            // TODO(task-support): render <task-notification> content once ready.
            if s.starts_with("<task-notification>") {
                return None;
            }
            content_blocks.push(text_block(s.clone()));
        }
        Some(Value::Array(arr)) => {
            content_blocks.extend(build_tool_result_blocks(message, tool_use_result));
            content_blocks.extend(extract_user_content_blocks(
                arr,
                &ExtractOpts {
                    skip_interrupted: true,
                },
            ));
        }
        _ => {}
    }

    if content_blocks.is_empty() {
        return None;
    }

    let has_tool_result = content_blocks.iter().any(|b| {
        matches!(
            b,
            MessageContent::Node(MessageContentNode::ToolResult { .. })
        )
    });
    Some(ChatMessage {
        id: id_or_nanoid(entry),
        chat_id: chat_id.to_string(),
        r#type: if has_tool_result {
            ChatMessageType::ToolResult
        } else {
            ChatMessageType::User
        },
        content: content_blocks,
        timestamp: timestamp_or_now(entry),
        metadata: Some(history_meta()),
    })
}

fn convert_assistant_entry(entry: &Value, message: &Value, chat_id: &str) -> Option<ChatMessage> {
    let mut content_blocks: Vec<MessageContent> = Vec::new();

    if let Some(Value::Array(arr)) = message.get("content") {
        for block in arr {
            match block.get("type").and_then(Value::as_str) {
                Some("text") => content_blocks.push(text_block(
                    block
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                )),
                Some("thinking") => {
                    // Hidden-thinking models emit signature-only blocks with empty prose — skip them.
                    let thinking = block
                        .get("thinking")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    if !thinking.trim().is_empty() {
                        content_blocks.push(MessageContent::Leaf(LeafContent::Thinking {
                            thinking,
                            parent_tool_use_id: None,
                        }))
                    }
                }
                Some("tool_use") => {
                    content_blocks.push(MessageContent::Node(MessageContentNode::ToolUse {
                        id: block
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                        name: block
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                        input: value_object_to_map(block.get("input")),
                        parent_tool_use_id: None,
                    }))
                }
                _ => {}
            }
        }
    }

    if content_blocks.is_empty() {
        return None;
    }

    let mut meta = history_meta();
    if js_truthy(message.get("model"))
        && let Some(model) = message.get("model")
    {
        meta.insert("model".to_string(), model.clone());
    }
    if js_truthy(message.get("usage"))
        && let Some(usage) = message.get("usage")
    {
        meta.insert("usage".to_string(), usage.clone());
    }

    Some(ChatMessage {
        id: id_or_nanoid(entry),
        chat_id: chat_id.to_string(),
        r#type: ChatMessageType::Assistant,
        content: content_blocks,
        timestamp: timestamp_or_now(entry),
        metadata: Some(meta),
    })
}

/// A queued message the CLI drained mid-turn persists to JSONL as a structured
/// `attachment` entry (type queued_command), not as a user entry.
fn convert_queued_command_entry(entry: &Value, chat_id: &str) -> Option<ChatMessage> {
    // `attachment?.type` — an absent attachment fails the type check below anyway.
    let attachment = entry.get("attachment")?;
    let atype = attachment.get("type").and_then(Value::as_str);
    let mode = attachment.get("commandMode").and_then(Value::as_str);
    if atype != Some("queued_command") || mode != Some("prompt") {
        return None;
    }

    let prompt = attachment.get("prompt");
    let mut content_blocks: Vec<MessageContent> = Vec::new();
    match prompt {
        Some(Value::String(s)) => {
            if !s.trim().is_empty() {
                content_blocks.push(text_block(s.clone()));
            }
        }
        Some(Value::Array(arr)) => {
            content_blocks.extend(extract_user_content_blocks(
                arr,
                &ExtractOpts {
                    skip_interrupted: false,
                },
            ));
        }
        _ => {}
    }
    if content_blocks.is_empty() {
        return None;
    }

    let timestamp = entry
        .get("timestamp")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            attachment
                .get("timestamp")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
        })
        .map(str::to_string)
        .unwrap_or_else(now_iso8601);

    Some(ChatMessage {
        id: id_or_nanoid(entry),
        chat_id: chat_id.to_string(),
        r#type: ChatMessageType::User,
        content: content_blocks,
        timestamp,
        metadata: Some(history_meta()),
    })
}

pub fn convert_history_entry(entry: &Value, chat_id: &str) -> Option<ChatMessage> {
    let entry_type = entry.get("type").and_then(Value::as_str);

    if entry_type == Some("attachment") {
        return convert_queued_command_entry(entry, chat_id);
    }

    if entry_type == Some("system")
        && entry.get("subtype").and_then(Value::as_str) == Some("compact_boundary")
    {
        let mut meta = history_meta();
        meta.insert("internal".to_string(), Value::Bool(true));
        return Some(ChatMessage {
            id: id_or_nanoid(entry),
            chat_id: chat_id.to_string(),
            r#type: ChatMessageType::System,
            content: vec![MessageContent::Node(MessageContentNode::Compaction {
                parent_tool_use_id: None,
            })],
            timestamp: timestamp_or_now(entry),
            metadata: Some(meta),
        });
    }

    if entry_type == Some("result")
        && entry.get("subtype").and_then(Value::as_str) == Some("error_during_execution")
        && !matches!(entry.get("is_error"), Some(Value::Bool(false)))
    {
        return Some(ChatMessage {
            id: id_or_nanoid(entry),
            chat_id: chat_id.to_string(),
            r#type: ChatMessageType::Error,
            content: vec![MessageContent::Node(MessageContentNode::Error {
                message: "Session ended unexpectedly".to_string(),
                parent_tool_use_id: None,
            })],
            timestamp: timestamp_or_now(entry),
            metadata: Some(history_meta()),
        });
    }

    if entry_type != Some("user") && entry_type != Some("assistant") {
        return None;
    }

    let message = match entry.get("message") {
        Some(m) if js_truthy(Some(m)) => m,
        _ => return None,
    };

    if entry_type == Some("user") {
        return convert_user_entry(entry, message, chat_id);
    }
    if entry_type == Some("assistant") {
        return convert_assistant_entry(entry, message, chat_id);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn attachment_entry(over: Value, attachment_over: Value) -> Value {
        let mut attachment = json!({
            "type": "queued_command",
            "prompt": [{ "type": "text", "text": "original queued text" }],
            "source_uuid": "u-src",
            "commandMode": "prompt",
            "timestamp": "2026-07-04T00:00:00Z"
        });
        if let Some(o) = attachment_over.as_object() {
            for (k, v) in o {
                attachment[k] = v.clone();
            }
        }
        let mut entry = json!({
            "type": "attachment",
            "uuid": "e1",
            "timestamp": "2026-07-04T00:00:01Z",
            "attachment": attachment
        });
        if let Some(o) = over.as_object() {
            for (k, v) in o {
                entry[k] = v.clone();
            }
        }
        entry
    }

    #[test]
    fn converts_prompt_mode_queued_command_with_original_text() {
        let msg = convert_history_entry(&attachment_entry(json!({}), json!({})), "c1").unwrap();
        assert_eq!(msg.r#type, ChatMessageType::User);
        assert_eq!(
            msg.content,
            vec![text_block("original queued text".to_string())]
        );
        assert_eq!(msg.id, "e1");
        assert_eq!(msg.timestamp, "2026-07-04T00:00:01Z");
        assert_eq!(msg.metadata, Some(history_meta()));
    }

    #[test]
    fn skips_signature_only_empty_thinking_blocks_in_assistant_history() {
        let entry = json!({
            "type": "assistant",
            "uuid": "a1",
            "timestamp": "2026-07-04T00:00:01Z",
            "message": { "content": [
                { "type": "thinking", "thinking": "   ", "signature": "sig" },
                { "type": "thinking", "thinking": "real plan" },
                { "type": "text", "text": "hi" },
            ]}
        });
        let msg = convert_history_entry(&entry, "c1").unwrap();
        let thinkings: Vec<&str> = msg
            .content
            .iter()
            .filter_map(|b| match b {
                MessageContent::Leaf(LeafContent::Thinking { thinking, .. }) => {
                    Some(thinking.as_str())
                }
                _ => None,
            })
            .collect();
        assert_eq!(thinkings, vec!["real plan"]);
    }

    #[test]
    fn handles_a_plain_string_prompt() {
        let msg = convert_history_entry(
            &attachment_entry(json!({}), json!({ "prompt": "string prompt" })),
            "c1",
        )
        .unwrap();
        assert_eq!(msg.content, vec![text_block("string prompt".to_string())]);
    }

    #[test]
    fn returns_null_for_task_notification_command_mode() {
        assert!(
            convert_history_entry(
                &attachment_entry(json!({}), json!({ "commandMode": "task-notification" })),
                "c1"
            )
            .is_none()
        );
    }

    #[test]
    fn returns_null_for_non_queued_command_attachments() {
        assert!(
            convert_history_entry(
                &attachment_entry(json!({}), json!({ "type": "edited_text_file" })),
                "c1"
            )
            .is_none()
        );
    }

    #[test]
    fn converts_the_real_captured_fixture_entry() {
        let raw = include_str!("__fixtures__/queued-command-attachment.jsonl");
        let entry = raw
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| serde_json::from_str::<Value>(l).unwrap())
            .find(|e| {
                e.get("type").and_then(Value::as_str) == Some("attachment")
                    && e.get("attachment")
                        .and_then(|a| a.get("type"))
                        .and_then(Value::as_str)
                        == Some("queued_command")
            })
            .expect("fixture must contain a queued_command attachment entry");
        let msg = convert_history_entry(&entry, "c1").unwrap();
        assert_eq!(msg.r#type, ChatMessageType::User);
        let text: String = msg
            .content
            .iter()
            .map(|b| match b {
                MessageContent::Leaf(LeafContent::Text { text, .. }) => text.as_str(),
                _ => "",
            })
            .collect();
        assert!(!text.is_empty());
        assert!(!text.contains("queued_command"));
    }
}

// PORT STATUS: src/plugins/builtin/claude/history-converters.ts (268 lines)
// confidence: high
// todos: 0
// notes: Main catch-up (#419): assistant-entry conversion skips signature-only empty
// notes: `thinking` blocks (trim-empty prose) — hidden-thinking models. Unit test added.
// notes: JSONL entries are serde_json::Value (TS Record<string,unknown>). `||`
// vs `??` fallbacks are preserved distinctly (id_or_nanoid/uuid_or_nanoid_nullish
// + timestamp variants). The three `/…/m` regexes are hand-rolled via
// base_dir_line_start (line-start anchor). metadata maps use HashMap (toEqual is
// order-insensitive). nanoid!() matches the JS default alphabet/length. All 5 TS
// tests ported incl. the verbatim-copied queued-command fixture (src/__fixtures__).
// The `// TODO(task-support)` comment is carried verbatim from the TS source (not
// a TODO(port)).
