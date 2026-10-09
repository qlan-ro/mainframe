//! `ChatMessage` → `HandoffItem`: the verbatim, summarised history a handoff
//! carries. Pure; tool names are the canonical ones both adapters emit.

use std::collections::HashSet;

use super::render::{escape, strip_marker};
use super::tool_items::{MapCtx, latest_todo_write, tool_item, tool_outcomes};
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};
use mainframe_types::content::LeafContent;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemKind {
    User,
    Assistant,
    Command,
    FileChange,
    Plan,
    Todos,
    SubagentResult,
    Error,
}

impl ItemKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
            Self::Command => "command",
            Self::FileChange => "file_change",
            Self::Plan => "plan",
            Self::Todos => "todos",
            Self::SubagentResult => "subagent_result",
            Self::Error => "error",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct HandoffItem {
    pub kind: ItemKind,
    /// 1-based index of its user turn in the composed chat.
    pub turn: u32,
    /// The segment's adapter display name.
    pub provider: String,
    pub text: String,
}

/// One segment's messages. Turn numbering runs over every span, but only
/// `covered` spans produce items.
pub struct SpanInput<'a> {
    pub provider: &'a str,
    pub messages: &'a [ChatMessage],
    pub covered: bool,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct MappedHistory {
    pub items: Vec<HandoffItem>,
    /// First and last user turn inside the covered spans.
    pub turns: Option<(u32, u32)>,
    /// Display names of the covered spans' providers, in order, deduplicated.
    pub providers: Vec<String>,
}

pub fn map_items(spans: &[SpanInput<'_>], subagent_tools: &HashSet<String>) -> MappedHistory {
    let outcomes = tool_outcomes(spans);
    let latest_todos = latest_todo_write(spans);
    let mut out = MappedHistory::default();
    let mut turn = 0u32;
    for span in spans {
        if span.covered && !out.providers.iter().any(|p| p == span.provider) {
            out.providers.push(span.provider.to_string());
        }
        for msg in span.messages {
            if let Some(text) = user_text(msg) {
                turn += 1;
                if span.covered {
                    out.turns = Some((out.turns.map_or(turn, |t| t.0), turn));
                    out.items
                        .push(item(ItemKind::User, turn, span.provider, text));
                }
                continue;
            }
            if !span.covered {
                continue;
            }
            let ctx = MapCtx {
                turn,
                provider: span.provider,
                outcomes: &outcomes,
                latest_todos: latest_todos.as_deref(),
                subagent_tools,
            };
            map_message(msg, &ctx, &mut out.items);
        }
    }
    out
}

pub(super) fn item(kind: ItemKind, turn: u32, provider: &str, text: String) -> HandoffItem {
    HandoffItem {
        kind,
        turn,
        provider: provider.to_string(),
        text: escape(&text),
    }
}

fn is_subagent_block(content: &MessageContent) -> bool {
    let parent = match content {
        MessageContent::Leaf(
            LeafContent::Text {
                parent_tool_use_id, ..
            }
            | LeafContent::Thinking {
                parent_tool_use_id, ..
            }
            | LeafContent::Image {
                parent_tool_use_id, ..
            }
            | LeafContent::SkillLoaded {
                parent_tool_use_id, ..
            },
        ) => parent_tool_use_id,
        MessageContent::Node(
            MessageContentNode::ToolUse {
                parent_tool_use_id, ..
            }
            | MessageContentNode::ToolResult {
                parent_tool_use_id, ..
            }
            | MessageContentNode::PermissionRequest {
                parent_tool_use_id, ..
            }
            | MessageContentNode::Error {
                parent_tool_use_id, ..
            }
            | MessageContentNode::Compaction { parent_tool_use_id },
        ) => parent_tool_use_id,
        MessageContent::Node(MessageContentNode::ProviderSwitch { .. }) => return false,
    };
    parent.as_deref().is_some_and(|p| !p.is_empty())
}

/// A user message's visible text (marker stripped, attachments and images as
/// placeholders), or `None` when it carries no text — tool results and
/// subagent prompts are not turns.
fn user_text(msg: &ChatMessage) -> Option<String> {
    if msg.r#type != ChatMessageType::User {
        return None;
    }
    let mut parts: Vec<String> = Vec::new();
    for block in msg.content.iter().filter(|b| !is_subagent_block(b)) {
        match block {
            MessageContent::Leaf(LeafContent::Text { text, .. }) => {
                parts.push(attachment_placeholders(strip_marker(text)));
            }
            MessageContent::Leaf(LeafContent::Image { .. }) => parts.push("[image]".to_string()),
            _ => {}
        }
    }
    let text = parts.join("\n");
    (!text.trim().is_empty()).then_some(text)
}

/// `<attached_file_path name="x" …/>` becomes `[attached file: x]`.
pub fn attachment_placeholders(text: &str) -> String {
    const OPEN: &str = "<attached_file_path";
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(OPEN) {
        out.push_str(&rest[..start]);
        let tag = &rest[start..];
        let Some(end) = tag.find('>') else {
            out.push_str(tag);
            return out;
        };
        let name = tag[..end]
            .split("name=\"")
            .nth(1)
            .and_then(|v| v.split('"').next())
            .unwrap_or("file");
        out.push_str(&format!("[attached file: {name}]"));
        rest = &tag[end + 1..];
    }
    out.push_str(rest);
    out
}

fn map_message(msg: &ChatMessage, ctx: &MapCtx<'_>, out: &mut Vec<HandoffItem>) {
    for block in msg.content.iter().filter(|b| !is_subagent_block(b)) {
        match block {
            MessageContent::Leaf(LeafContent::Text { text, .. })
                if msg.r#type == ChatMessageType::Assistant && !text.trim().is_empty() =>
            {
                out.push(item(
                    ItemKind::Assistant,
                    ctx.turn,
                    ctx.provider,
                    text.clone(),
                ));
            }
            MessageContent::Node(MessageContentNode::ToolUse {
                id, name, input, ..
            }) => {
                if let Some((kind, text)) = tool_item(id, name, input, ctx) {
                    out.push(item(kind, ctx.turn, ctx.provider, text));
                }
            }
            MessageContent::Node(MessageContentNode::Error { message, .. }) => {
                out.push(item(
                    ItemKind::Error,
                    ctx.turn,
                    ctx.provider,
                    message.clone(),
                ));
            }
            _ => {}
        }
    }
}
