//! `encode_content` and its per-leaf-kind helpers, split out of
//! `encoder.rs` (todo #350, plan task 37, R2.13) — the 125-line match this
//! module breaks up was itself the single biggest function in the crate
//! (`cargo clippy -- -W clippy::too_many_lines`).

use mainframe_types::display::has_attachment_evidence;

use super::accum::{Accum, AccumKind};
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

/// Encode one content list (a `DisplayMessage`'s top-level content, or a
/// flattened `TaskGroup`'s nested `calls`) under `container`. Text/image
/// leaves accumulate into message items and thinking leaves into thought
/// items, each segmented at the points where another item interrupts the run.
pub(super) fn encode_content(
    content: &[DisplayContent],
    container: &Container<'_>,
    role: ItemRole,
    out: &mut Vec<EncodedItem>,
) {
    let mut message = Accum::new(AccumKind::Message(role));
    let mut thought = Accum::new(AccumKind::Thought);

    for block in content {
        handle_block(block, container, role, &mut message, &mut thought, out);
    }

    // A user container with attachment evidence but zero content leaves
    // never claims the accumulator, so `finish` would emit no item and take
    // the container's metadata (the attachment previews) with it — open an
    // empty slot so the item still surfaces with its ItemMeta intact.
    if role == ItemRole::User && has_attachment_evidence(container.message_meta) {
        message.claim_marker(out, container);
    }

    message.finish(container, out);
    thought.finish(container, out);
}

fn handle_block(
    block: &DisplayContent,
    container: &Container<'_>,
    role: ItemRole,
    message: &mut Accum,
    thought: &mut Accum,
    out: &mut Vec<EncodedItem>,
) {
    match block {
        DisplayContent::Leaf(leaf) => handle_leaf(leaf, container, message, thought, out),
        DisplayContent::Node(node) => handle_node(node, container, role, message, out),
    }
}

fn handle_leaf(
    leaf: &LeafContent,
    container: &Container<'_>,
    message: &mut Accum,
    thought: &mut Accum,
    out: &mut Vec<EncodedItem>,
) {
    match leaf {
        LeafContent::Text { text, .. } => {
            push_text(&mut message.claim(out, container).blocks, text);
        }
        LeafContent::Thinking { thinking, .. } => {
            push_text(&mut thought.claim(out, container).blocks, thinking);
        }
        LeafContent::Image {
            media_type, data, ..
        } => message
            .claim(out, container)
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
            message.claim_marker(out, container).skill_loaded = Some(SkillLoadedMeta {
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
    message: &mut Accum,
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
            let accum = message.claim(out, container);
            if container.kind == Some(ItemContainerKind::Error) && accum.error_text.is_none() {
                accum.error_text = Some(m.clone());
            }
            push_text(&mut accum.blocks, m);
        }
        DisplayNode::Compaction { .. } => {
            message.claim_marker(out, container).is_compacted = true;
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
