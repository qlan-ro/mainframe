//! `encode_content` and its per-leaf-kind helpers, split out of `encoder.rs` —
//! the 125-line match this module breaks up was itself the single biggest
//! function in the crate (`cargo clippy -- -W clippy::too_many_lines`).

use mainframe_types::display::{StreamingLeafKind, has_attachment_evidence};

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
///
/// `streaming` marks the item backed by the partial overlay
/// (`encoder.rs::encode_revision`): when the message or thought accumulator is
/// still open at `finish` and its kind matches, the finished item's
/// `ItemMeta.streaming` is `Some(true)`. A segment closed earlier by an
/// interruption never carries it — only the segment still open at the end of
/// this container is "the one streaming right now". `None` everywhere
/// (`encode`'s plain call, and every nested `TaskGroup` call) produces
/// unmarked output.
pub(super) fn encode_content(
    content: &[DisplayContent],
    container: &Container<'_>,
    role: ItemRole,
    out: &mut Vec<EncodedItem>,
    streaming: Option<StreamingLeafKind>,
) {
    let mut message = Accum::new(AccumKind::Message(role));
    let mut thought = Accum::new(AccumKind::Thought);

    for (index, block) in content.iter().enumerate() {
        let mut source_container = container.clone();
        source_container.path.push(index);
        handle_block(
            block,
            &source_container,
            role,
            &mut message,
            &mut thought,
            out,
        );
    }

    // Attachment evidence with no leaves never claims — open the slot so finish emits the item.
    if role == ItemRole::User && has_attachment_evidence(container.message_meta) {
        message.claim_marker(out, container);
    }

    message.finish(container, out, streaming == Some(StreamingLeafKind::Text));
    thought.finish(
        container,
        out,
        streaming == Some(StreamingLeafKind::Thinking),
    );
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
            let accum = message.claim(out, container);
            presentation::push_leaf(accum, leaf, container);
            push_text(&mut accum.blocks, text);
        }
        LeafContent::Thinking { thinking, .. } => {
            let accum = thought.claim(out, container);
            presentation::push_leaf(accum, leaf, container);
            push_text(&mut accum.blocks, thinking);
        }
        LeafContent::Image {
            media_type, data, ..
        } => {
            let accum = message.claim(out, container);
            presentation::push_leaf(accum, leaf, container);
            accum.blocks.push(ContentBlock::Image {
                data: data.clone(),
                mime_type: media_type.clone(),
                uri: None,
                meta: None,
            });
        }
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
            timing,
            command_execution,
            ..
        } => {
            if *category != ToolCategory::Hidden {
                out.push(tool_call_item(
                    id,
                    name,
                    input,
                    *category,
                    result,
                    container,
                    None,
                    *timing,
                    command_execution,
                ));
            }
        }
        DisplayNode::ToolGroup { calls } => encode_tool_group(calls, container, out),
        DisplayNode::TaskGroup {
            agent_id,
            task_args,
            calls,
            result,
            timing,
        } => handle_task_group(
            agent_id, task_args, calls, result, container, role, out, *timing,
        ),
        DisplayNode::TaskProgress { items } => handle_task_progress(items, container, out),
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
        DisplayNode::ProviderSwitch { marker } => {
            // The meta drives the divider; the label text is what clients
            // without provider-switch rendering (mobile) show instead.
            let accum = message.claim(out, container);
            accum.provider_switch = Some(marker.clone());
            push_text(&mut accum.blocks, &marker.label());
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
    timing: Option<mainframe_types::tool_call_timing::ToolCallTiming>,
) {
    out.push(task_group_item(
        agent_id, task_args, result, container, timing,
    ));
    let child = Container {
        presentation_sources: container.presentation_sources,
        path: container.path.clone(),
        id: agent_id,
        timestamp: container.timestamp,
        kind: None,
        message_meta: None,
        parent_tool_call_id: Some(agent_id),
    };
    // The overlay backs only the top-level container `encode_revision` names;
    // a subagent's own content never streams, so this nested call always
    // passes `None`.
    encode_content(calls, &child, role, out, None);
}

fn handle_task_progress(
    items: &[mainframe_types::display::TaskProgressItem],
    container: &Container<'_>,
    out: &mut Vec<EncodedItem>,
) {
    for (index, item) in items.iter().enumerate() {
        let mut source_container = container.clone();
        source_container.path.push(index);
        if item.category != ToolCategory::Hidden {
            out.push(tool_call_item(
                &item.id,
                &item.name,
                &item.input,
                item.category,
                &item.result,
                &source_container,
                None,
                item.timing,
                &None,
            ));
        }
    }
}
