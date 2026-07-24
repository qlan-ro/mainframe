//! Ported from `packages/core/src/plugins/builtin/codex/history.ts`.
//!
//! `convert_thread_items` — the chat-reload path. Also hosts the crate-shared
//! `MessageContent` block builders + the `with_parent` tagger (reused by
//! `event_mapper`), and a crate-local `parse_unified_diff` shim (see the trailer
//! blocker note).

use std::collections::HashMap;

use mainframe_types::chat::{
    ChatMessage, ChatMessageType, DiffHunk, MessageContent, MessageContentNode,
};
use mainframe_types::content::LeafContent;
use serde_json::{Value, json};

use crate::item_types::{CollabAgentToolCallItem, PatchChangeKind, ThreadItem};
use crate::thread_registry::{AgentMetadata, agent_title, describe_agent};

pub fn convert_thread_items(
    items: &[ThreadItem],
    chat_id: &str,
    child_items_by_thread: &HashMap<String, Vec<ThreadItem>>,
    agent_meta_by_thread: &HashMap<String, AgentMetadata>,
) -> Vec<ChatMessage> {
    let mut messages: Vec<ChatMessage> = Vec::new();
    // Stash spawnAgent prompts (keyed by child thread id) so the matching `wait`
    // item can use them as the TaskGroup card's description.
    let mut spawn_prompts: HashMap<String, String> = HashMap::new();

    for item in items {
        match item {
            ThreadItem::AgentMessage(m) => {
                messages.push(make_message(
                    &m.id,
                    chat_id,
                    ChatMessageType::Assistant,
                    vec![text_block(&m.text)],
                ));
            }
            ThreadItem::Reasoning(r) => {
                messages.push(make_message(
                    &r.id,
                    chat_id,
                    ChatMessageType::Assistant,
                    vec![thinking_block(&reasoning_text(&r.summary, &r.content))],
                ));
            }
            ThreadItem::CommandExecution(c) => {
                messages.push(make_message(
                    &c.id,
                    chat_id,
                    ChatMessageType::Assistant,
                    vec![tool_use_block(&c.id, "Bash", bash_input(&c.command))],
                ));
                messages.push(make_message(
                    &format!("{}:result", c.id),
                    chat_id,
                    ChatMessageType::ToolResult,
                    vec![tool_result_block(
                        &c.id,
                        &c.aggregated_output,
                        is_exec_error(c.exit_code),
                        None,
                    )],
                ));
            }
            ThreadItem::FileChange(f) => {
                let is_error = f.status == "failed" || f.status == "declined";
                for (index, change) in f.changes.iter().enumerate() {
                    let tool_id = format!("{}:{}", f.id, index);
                    let is_add = matches!(change.kind, PatchChangeKind::Add);
                    let tool_name = if is_add { "Write" } else { "Edit" };
                    let structured_patch = parse_unified_diff(&change.diff);
                    let input = file_change_input(is_add, &change.path, &change.diff, &change.kind);
                    messages.push(make_message(
                        &tool_id,
                        chat_id,
                        ChatMessageType::Assistant,
                        vec![tool_use_block(&tool_id, tool_name, input)],
                    ));
                    let sp = if structured_patch.is_empty() {
                        None
                    } else {
                        Some(structured_patch)
                    };
                    messages.push(make_message(
                        &format!("{tool_id}:result"),
                        chat_id,
                        ChatMessageType::ToolResult,
                        vec![tool_result_block(&tool_id, "OK", is_error, sp)],
                    ));
                }
            }
            ThreadItem::McpToolCall(m) => {
                let server = m.server.as_deref().unwrap_or("codex");
                let tool_name = format!("mcp__{server}__{}", m.tool);
                messages.push(make_message(
                    &m.id,
                    chat_id,
                    ChatMessageType::Assistant,
                    vec![tool_use_block(&m.id, &tool_name, m.arguments.clone())],
                ));
                let content =
                    mcp_result_content(m.result.as_ref().map(|r| &r.content), m.error.as_ref());
                messages.push(make_message(
                    &format!("{}:result", m.id),
                    chat_id,
                    ChatMessageType::ToolResult,
                    vec![tool_result_block(&m.id, &content, m.error.is_some(), None)],
                ));
            }
            ThreadItem::UserMessage(u) => {
                let text = user_message_text(u);
                if text.is_empty() {
                    continue;
                }
                messages.push(make_message(
                    &u.id,
                    chat_id,
                    ChatMessageType::User,
                    vec![text_block(&text)],
                ));
            }
            ThreadItem::CollabAgentToolCall(item) => {
                // `spawnAgent` is dispatch metadata only — stash its prompt for the `wait` card.
                if item.tool == "spawnAgent" {
                    if let (Some(children), Some(prompt)) =
                        (&item.receiver_thread_ids, &item.prompt)
                    {
                        for child_id in children {
                            spawn_prompts.insert(child_id.clone(), prompt.clone());
                        }
                    }
                    continue;
                }
                emit_collab_agent(
                    &mut messages,
                    chat_id,
                    item,
                    &mut spawn_prompts,
                    child_items_by_thread,
                    agent_meta_by_thread,
                );
            }
            ThreadItem::ContextCompaction(c) => {
                // Same "Context compacted" pill Claude's compact_boundary produces.
                messages.push(make_message(
                    &c.id,
                    chat_id,
                    ChatMessageType::System,
                    vec![MessageContent::Node(MessageContentNode::Compaction {
                        parent_tool_use_id: None,
                    })],
                ));
            }
            ThreadItem::ImageGeneration(img) => {
                if let Some(m) = crate::image_generation_history::image_generation_message(img, chat_id) {
                    messages.push(m);
                }
            }
            ThreadItem::WebSearch(w) => {
                messages.extend(crate::web_search_history::web_search_messages(w, chat_id));
            }
            // todoList — skip for now
            _ => {}
        }
    }

    messages
}

fn emit_collab_agent(
    messages: &mut Vec<ChatMessage>,
    chat_id: &str,
    item: &CollabAgentToolCallItem,
    spawn_prompts: &mut HashMap<String, String>,
    child_items_by_thread: &HashMap<String, Vec<ThreadItem>>,
    agent_meta_by_thread: &HashMap<String, AgentMetadata>,
) {
    let is_error = item.status == "failed" || item.status == "interrupted";
    let child_id = item
        .receiver_thread_ids
        .as_ref()
        .and_then(|ids| ids.first());
    let meta = child_id.and_then(|c| agent_meta_by_thread.get(c));
    let subagent_type = agent_title(meta)
        .or_else(|| describe_agent(meta))
        .unwrap_or_else(|| "Sub-agent".to_string());
    let prompt = child_id
        .and_then(|c| spawn_prompts.get(c).cloned())
        .or_else(|| item.prompt.clone())
        .unwrap_or_default();
    let description = describe_agent(meta).unwrap_or_else(|| {
        if prompt.is_empty() {
            subagent_type.clone()
        } else {
            prompt.clone()
        }
    });
    let sub_agent_message = child_id
        .and_then(|c| item.agents_states.as_ref().and_then(|s| s.get(c)))
        .and_then(|s| s.message.clone());

    let mut content: Vec<MessageContent> = vec![collab_agent_tool_use(
        &item.id,
        &prompt,
        &description,
        &subagent_type,
    )];
    let mut child_tool_results: Vec<MessageContent> = Vec::new();

    if let Some(cid) = child_id
        && let Some(child_items) = child_items_by_thread.get(cid)
        && !child_items.is_empty()
    {
        let empty = HashMap::new();
        let child_messages =
            convert_thread_items(child_items, chat_id, child_items_by_thread, &empty);
        for m in &child_messages {
            // Skip the child thread's user-prompt echo.
            if m.r#type == ChatMessageType::User {
                continue;
            }
            for block in &m.content {
                if matches!(
                    block,
                    MessageContent::Node(
                        mainframe_types::chat::MessageContentNode::ToolResult { .. }
                    )
                ) {
                    child_tool_results.push(with_parent(block.clone(), &item.id));
                } else {
                    content.push(with_parent(block.clone(), &item.id));
                }
            }
        }
    }

    messages.push(make_message(
        &item.id,
        chat_id,
        ChatMessageType::Assistant,
        content,
    ));
    for (index, r) in child_tool_results.into_iter().enumerate() {
        messages.push(make_message(
            &format!("{}:child:{index}:result", item.id),
            chat_id,
            ChatMessageType::ToolResult,
            vec![r],
        ));
    }
    // Close the card with the CollabAgent's own tool_result (sub-agent's final message).
    let final_content = sub_agent_message.unwrap_or_else(|| "Sub-agent completed".to_string());
    messages.push(make_message(
        &format!("{}:result", item.id),
        chat_id,
        ChatMessageType::ToolResult,
        vec![tool_result_block(&item.id, &final_content, is_error, None)],
    ));
    if let Some(cid) = child_id {
        spawn_prompts.remove(cid);
    }
}

/// Build a `ChatMessage` with a CALLER-SUPPLIED deterministic id (derived from the
/// Codex thread item's stable `id`), so reconstructing the same items yields the
/// same ids every turn (lets the display delta emitter detect appends/updates).
pub(crate) fn make_message(
    id: &str,
    chat_id: &str,
    r#type: ChatMessageType,
    content: Vec<MessageContent>,
) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: chat_id.to_string(),
        r#type,
        content,
        timestamp: mainframe_runtime::time::now_iso8601(),
        metadata: None,
    }
}

pub(crate) fn reasoning_text(summary: &[String], content: &[String]) -> String {
    let s = summary.join("\n");
    if s.is_empty() { content.join("\n") } else { s }
}

fn user_message_text(u: &crate::item_types::UserMessageItem) -> String {
    u.content
        .as_ref()
        .and_then(|blocks| {
            blocks
                .iter()
                .find(|b| b.text.as_deref().map(|t| !t.is_empty()).unwrap_or(false))
                .and_then(|b| b.text.clone())
        })
        .or_else(|| u.text.clone())
        .unwrap_or_default()
}

pub(crate) fn is_exec_error(exit_code: Option<i64>) -> bool {
    exit_code.map(|c| c != 0).unwrap_or(false)
}

pub(crate) fn bash_input(command: &str) -> HashMap<String, Value> {
    let mut m = HashMap::new();
    m.insert("command".to_string(), json!(command));
    m
}

pub(crate) fn file_change_input(
    is_add: bool,
    path: &str,
    diff: &str,
    kind: &PatchChangeKind,
) -> HashMap<String, Value> {
    let mut m = HashMap::new();
    m.insert("file_path".to_string(), json!(path));
    if is_add {
        m.insert("content".to_string(), json!(extract_added_content(diff)));
    } else {
        m.insert("old_string".to_string(), json!(""));
        m.insert("new_string".to_string(), json!(""));
        if let PatchChangeKind::Update {
            move_path: Some(mp),
        } = kind
        {
            m.insert("move_path".to_string(), json!(mp));
        }
    }
    m
}

pub(crate) fn mcp_result_content(
    content: Option<&Value>,
    error: Option<&crate::item_types::CodexItemError>,
) -> String {
    if let Some(err) = error {
        return err.message.clone();
    }
    // `JSON.stringify(item.result?.content ?? '')`
    let val = content
        .filter(|c| !c.is_null())
        .cloned()
        .unwrap_or(Value::String(String::new()));
    serde_json::to_string(&val).unwrap_or_default()
}

pub(crate) fn extract_added_content(diff: &str) -> String {
    diff.split('\n')
        .filter(|line| line.starts_with('+') && !line.starts_with("+++"))
        .map(|line| &line[1..])
        .collect::<Vec<_>>()
        .join("\n")
}

// ── Crate-shared MessageContent block builders (reused by event_mapper) ──────────

pub(crate) fn text_block(text: &str) -> MessageContent {
    MessageContent::Leaf(LeafContent::Text {
        text: text.to_string(),
        parent_tool_use_id: None,
    })
}

pub(crate) fn thinking_block(text: &str) -> MessageContent {
    MessageContent::Leaf(LeafContent::Thinking {
        thinking: text.to_string(),
        parent_tool_use_id: None,
    })
}

pub(crate) fn image_block(media_type: &str, data: &str) -> MessageContent {
    MessageContent::Leaf(LeafContent::Image {
        media_type: media_type.to_string(),
        data: data.to_string(),
        parent_tool_use_id: None,
    })
}

pub(crate) fn tool_use_block(
    id: &str,
    name: &str,
    input: HashMap<String, Value>,
) -> MessageContent {
    MessageContent::Node(mainframe_types::chat::MessageContentNode::ToolUse {
        id: id.to_string(),
        name: name.to_string(),
        input,
        parent_tool_use_id: None,
    })
}

pub(crate) fn tool_result_block(
    tool_use_id: &str,
    content: &str,
    is_error: bool,
    structured_patch: Option<Vec<DiffHunk>>,
) -> MessageContent {
    MessageContent::Node(mainframe_types::chat::MessageContentNode::ToolResult {
        tool_use_id: tool_use_id.to_string(),
        content: content.to_string(),
        is_error,
        structured_patch,
        original_file: None,
        modified_file: None,
        parent_tool_use_id: None,
    })
}

pub(crate) fn collab_agent_tool_use(
    id: &str,
    prompt: &str,
    description: &str,
    subagent_type: &str,
) -> MessageContent {
    let mut input = HashMap::new();
    input.insert("prompt".to_string(), json!(prompt));
    input.insert("description".to_string(), json!(description));
    input.insert("subagent_type".to_string(), json!(subagent_type));
    tool_use_block(id, "CollabAgent", input)
}

/// Tag a block with `parentToolUseId` (mirrors the TS `{ ...b, parentToolUseId }`).
pub(crate) fn with_parent(block: MessageContent, pid: &str) -> MessageContent {
    use mainframe_types::chat::MessageContentNode as N;
    let pid = Some(pid.to_string());
    match block {
        MessageContent::Leaf(LeafContent::Text { text, .. }) => {
            MessageContent::Leaf(LeafContent::Text {
                text,
                parent_tool_use_id: pid,
            })
        }
        MessageContent::Leaf(LeafContent::Thinking { thinking, .. }) => {
            MessageContent::Leaf(LeafContent::Thinking {
                thinking,
                parent_tool_use_id: pid,
            })
        }
        MessageContent::Leaf(LeafContent::Image {
            media_type, data, ..
        }) => MessageContent::Leaf(LeafContent::Image {
            media_type,
            data,
            parent_tool_use_id: pid,
        }),
        MessageContent::Leaf(LeafContent::SkillLoaded {
            skill_name,
            path,
            content,
            ..
        }) => MessageContent::Leaf(LeafContent::SkillLoaded {
            skill_name,
            path,
            content,
            parent_tool_use_id: pid,
        }),
        MessageContent::Node(N::ToolUse {
            id, name, input, ..
        }) => MessageContent::Node(N::ToolUse {
            id,
            name,
            input,
            parent_tool_use_id: pid,
        }),
        MessageContent::Node(N::ToolResult {
            tool_use_id,
            content,
            is_error,
            structured_patch,
            original_file,
            modified_file,
            ..
        }) => MessageContent::Node(N::ToolResult {
            tool_use_id,
            content,
            is_error,
            structured_patch,
            original_file,
            modified_file,
            parent_tool_use_id: pid,
        }),
        MessageContent::Node(N::PermissionRequest { request, .. }) => {
            MessageContent::Node(N::PermissionRequest {
                request,
                parent_tool_use_id: pid,
            })
        }
        MessageContent::Node(N::Error { message, .. }) => MessageContent::Node(N::Error {
            message,
            parent_tool_use_id: pid,
        }),
        MessageContent::Node(N::Compaction { .. }) => MessageContent::Node(N::Compaction {
            parent_tool_use_id: pid,
        }),
    }
}

/// TODO(port): replace with `mainframe_display::parse_unified_diff::parse_unified_diff`
/// once that (currently-skeleton) module is ported by the mainframe-display task.
/// Faithful copy of `messages/parse-unified-diff.ts` kept crate-private meanwhile so
/// this crate compiles + tests green (BLOCKER surfaced in the task output).
pub(crate) fn parse_unified_diff(diff: &str) -> Vec<DiffHunk> {
    if diff.trim().is_empty() {
        return Vec::new();
    }
    let mut hunks: Vec<DiffHunk> = Vec::new();
    let mut current: Option<DiffHunk> = None;
    for line in diff.split('\n') {
        if let Some(hdr) = parse_hunk_header(line) {
            if let Some(c) = current.take() {
                hunks.push(c);
            }
            current = Some(hdr);
        } else if let Some(c) = current.as_mut() {
            c.lines.push(line.to_string());
        } else {
            current = Some(DiffHunk {
                old_start: 1,
                old_lines: 0,
                new_start: 1,
                new_lines: 0,
                lines: vec![line.to_string()],
            });
        }
    }
    if let Some(c) = current {
        hunks.push(c);
    }
    hunks
}

/// `^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@` — hand-rolled (no regex crate).
fn parse_hunk_header(line: &str) -> Option<DiffHunk> {
    let rest = line.strip_prefix("@@ -")?;
    let (old, rest) = rest.split_once(" +")?;
    // trailing " @@..." — take up to " @@"
    let (new, _) = rest.split_once(" @@")?;
    let (old_start, old_lines) = parse_pair(old)?;
    let (new_start, new_lines) = parse_pair(new)?;
    Some(DiffHunk {
        old_start,
        old_lines,
        new_start,
        new_lines,
        lines: Vec::new(),
    })
}

/// `<start>[,<lines>]` → `(start, lines)` (lines defaults to 1 when absent).
fn parse_pair(s: &str) -> Option<(i64, i64)> {
    match s.split_once(',') {
        Some((a, b)) => Some((a.parse().ok()?, b.parse().ok()?)),
        None => Some((s.parse().ok()?, 1)),
    }
}

// PORT STATUS: src/plugins/builtin/codex/history.ts (249 lines)
// confidence: medium
// todos: 1
// notes: BLOCKER — `parse_unified_diff` lives in a crate-private shim (faithful copy
// notes: of messages/parse-unified-diff.ts) because mainframe-display::parse_unified_diff
// notes: is still a skeleton; swap to the canonical fn once that task lands (TODO(port)).
// notes: This file also hosts the crate-shared MessageContent block builders + the
// notes: `with_parent` tagger (reused by event_mapper) to keep ONE canonical copy.
// notes: convert_thread_items takes all 4 params explicitly (TS defaulted the last
// notes: two); the recursive child call passes an empty agent-meta map, matching TS.
// notes: Tests in tests/history.rs — both codex/__tests__/history.test.ts (userMessage
// notes: shapes + id stability) AND src/__tests__/codex-history.test.ts (per-item-type
// notes: conversions), assertion-for-assertion.
