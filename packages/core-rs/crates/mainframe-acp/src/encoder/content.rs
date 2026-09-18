//! `encode_content` and its per-leaf-kind helpers, split out of
//! `encoder.rs` (todo #350, plan task 37, R2.13) — the 125-line match this
//! module breaks up was itself the single biggest function in the crate
//! (`cargo clippy -- -W clippy::too_many_lines`).

use super::*;

/// Append text to a block list, coalescing into a trailing text block — the
/// no-adjacent-text-blocks invariant (module doc).
pub(super) fn push_text(blocks: &mut Vec<ContentBlock>, text: &str) {
    if let Some(ContentBlock::Text { text: tail, .. }) = blocks.last_mut() {
        tail.push_str(text);
        return;
    }
    blocks.push(ContentBlock::Text {
        text: text.to_string(),
        meta: None,
    });
}

/// The container's message/thought item under construction: claimed (a
/// placeholder pushed) at its first contribution so the finished item sits
/// at first-contribution position, then filled in by `finish_message`/
/// `finish_thought`.
#[derive(Default)]
struct MessageAccum {
    pos: Option<usize>,
    blocks: Vec<ContentBlock>,
    error_text: Option<String>,
    skill_loaded: Option<SkillLoadedMeta>,
    is_compacted: bool,
}

impl MessageAccum {
    fn claim(&mut self, out: &mut Vec<EncodedItem>, placeholder: EncodedItem) -> &mut Self {
        if self.pos.is_none() {
            self.pos = Some(out.len());
            out.push(placeholder);
        }
        self
    }
}

fn message_placeholder(container: &Container<'_>, role: ItemRole) -> EncodedItem {
    EncodedItem::Message {
        id: container.message_item_id(),
        role,
        content: Vec::new(),
        meta: None,
    }
}

fn thought_placeholder(container: &Container<'_>) -> EncodedItem {
    EncodedItem::Thought {
        id: format!("{}-thought", container.id),
        content: Vec::new(),
        meta: None,
    }
}

/// Encode one content list (a `DisplayMessage`'s top-level content, or a
/// flattened `TaskGroup`'s nested `calls`) under `container`. Text/image
/// leaves accumulate into one message item's ordered block list, thinking
/// leaves into one thought item, each at its first-contribution position.
pub(super) fn encode_content(
    content: &[DisplayContent],
    container: &Container<'_>,
    role: ItemRole,
    out: &mut Vec<EncodedItem>,
) {
    let mut message = MessageAccum::default();
    let mut thought = MessageAccum::default();

    for block in content {
        handle_block(block, container, role, &mut message, &mut thought, out);
    }

    finish_message(container, role, message, out);
    finish_thought(container, thought, out);
}

fn handle_block(
    block: &DisplayContent,
    container: &Container<'_>,
    role: ItemRole,
    message: &mut MessageAccum,
    thought: &mut MessageAccum,
    out: &mut Vec<EncodedItem>,
) {
    match block {
        DisplayContent::Leaf(leaf) => handle_leaf(leaf, container, role, message, thought, out),
        DisplayContent::Node(node) => handle_node(node, container, role, message, out),
    }
}

fn handle_leaf(
    leaf: &LeafContent,
    container: &Container<'_>,
    role: ItemRole,
    message: &mut MessageAccum,
    thought: &mut MessageAccum,
    out: &mut Vec<EncodedItem>,
) {
    match leaf {
        LeafContent::Text { text, .. } => {
            push_text(
                &mut message
                    .claim(out, message_placeholder(container, role))
                    .blocks,
                text,
            );
        }
        LeafContent::Thinking { thinking, .. } => {
            push_text(
                &mut thought.claim(out, thought_placeholder(container)).blocks,
                thinking,
            );
        }
        LeafContent::Image {
            media_type, data, ..
        } => message
            .claim(out, message_placeholder(container, role))
            .blocks
            .push(ContentBlock::Image {
                data: data.clone(),
                mime_type: media_type.clone(),
                uri: None,
                meta: None,
            }),
        LeafContent::SkillLoaded {
            skill_name,
            path,
            content,
            ..
        } => {
            message
                .claim(out, message_placeholder(container, role))
                .skill_loaded = Some(SkillLoadedMeta {
                skill_name: skill_name.clone(),
                path: path.clone(),
                content: content.clone(),
            });
        }
    }
}

fn handle_node(
    node: &DisplayNode,
    container: &Container<'_>,
    role: ItemRole,
    message: &mut MessageAccum,
    out: &mut Vec<EncodedItem>,
) {
    match node {
        DisplayNode::ToolCall {
            id,
            name,
            input,
            category,
            result,
            ..
        } => {
            if *category != ToolCategory::Hidden {
                out.push(tool_call_item(
                    id, name, input, *category, result, container, None,
                ));
            }
        }
        DisplayNode::ToolGroup { calls } => encode_tool_group(calls, container, out),
        DisplayNode::TaskGroup {
            agent_id,
            task_args,
            calls,
            result,
        } => handle_task_group(agent_id, task_args, calls, result, container, role, out),
        DisplayNode::TaskProgress { items } => handle_task_progress(items, container, out),
        // Gates stay out-of-band on the facade (spec) — no item.
        DisplayNode::PermissionRequest { .. } => {}
        DisplayNode::Error { message: m } => {
            let accum = message.claim(out, message_placeholder(container, role));
            if container.kind == Some(ItemContainerKind::Error) && accum.error_text.is_none() {
                accum.error_text = Some(m.clone());
            }
            push_text(&mut accum.blocks, m);
        }
        DisplayNode::Compaction { .. } => {
            message
                .claim(out, message_placeholder(container, role))
                .is_compacted = true;
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_task_group(
    agent_id: &str,
    task_args: &HashMap<String, Value>,
    calls: &[DisplayContent],
    result: &Option<ToolCallResult>,
    container: &Container<'_>,
    role: ItemRole,
    out: &mut Vec<EncodedItem>,
) {
    out.push(task_group_item(agent_id, task_args, result, container));
    let child = Container {
        id: agent_id,
        timestamp: container.timestamp,
        kind: None,
        message_meta: None,
        parent_tool_call_id: Some(agent_id),
    };
    encode_content(calls, &child, role, out);
}

fn handle_task_progress(
    items: &[mainframe_types::display::TaskProgressItem],
    container: &Container<'_>,
    out: &mut Vec<EncodedItem>,
) {
    for item in items {
        if item.category != ToolCategory::Hidden {
            out.push(tool_call_item(
                &item.id,
                &item.name,
                &item.input,
                item.category,
                &item.result,
                container,
                None,
            ));
        }
    }
}

fn finish_message(
    container: &Container<'_>,
    role: ItemRole,
    message: MessageAccum,
    out: &mut [EncodedItem],
) {
    let Some(pos) = message.pos else { return };
    out[pos] = EncodedItem::Message {
        id: container.message_item_id(),
        role,
        content: message.blocks,
        meta: wrap_meta(ItemMeta {
            error_text: message.error_text,
            skill_loaded: message.skill_loaded,
            is_compacted: message.is_compacted.then_some(true),
            ..container.base_meta()
        }),
    };
}

fn finish_thought(container: &Container<'_>, thought: MessageAccum, out: &mut [EncodedItem]) {
    let Some(pos) = thought.pos else { return };
    out[pos] = EncodedItem::Thought {
        id: format!("{}-thought", container.id),
        content: thought.blocks,
        meta: wrap_meta(container.base_meta()),
    };
}
