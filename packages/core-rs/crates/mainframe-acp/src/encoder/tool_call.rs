use mainframe_types::tool_call_timing::ToolCallTiming;

use super::*;

/// Flatten a `tool_group` in place, stamping the daemon's membership on each
/// visible member: the first visible member's id doubles as the group id —
/// the same scheme the legacy projection used (`map-assistant-blocks.ts`).
pub(super) fn encode_tool_group(
    calls: &[DisplayContent],
    container: &Container<'_>,
    out: &mut Vec<EncodedItem>,
) {
    let group_id = calls.iter().find_map(|call| match call {
        DisplayContent::Node(DisplayNode::ToolCall { id, category, .. })
            if *category != ToolCategory::Hidden =>
        {
            Some(id.clone())
        }
        _ => None,
    });
    for call in calls {
        if let DisplayContent::Node(DisplayNode::ToolCall {
            id,
            name,
            input,
            category,
            result,
            timing,
            ..
        }) = call
            && *category != ToolCategory::Hidden
        {
            out.push(tool_call_item(
                id,
                name,
                input,
                *category,
                result,
                container,
                group_id.as_deref(),
                *timing,
            ));
        }
    }
}

fn category_to_kind(category: ToolCategory) -> ToolKind {
    match category {
        ToolCategory::Explore => ToolKind::Search,
        ToolCategory::Progress => ToolKind::Execute,
        ToolCategory::Subagent => ToolKind::Think,
        ToolCategory::Hidden | ToolCategory::Default => ToolKind::Other,
    }
}

fn status_for(result: &Option<ToolCallResult>) -> ToolCallStatus {
    match result {
        None => ToolCallStatus::InProgress,
        Some(r) if r.is_error => ToolCallStatus::Failed,
        Some(_) => ToolCallStatus::Completed,
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn tool_call_item(
    id: &str,
    name: &str,
    input: &HashMap<String, Value>,
    category: ToolCategory,
    result: &Option<ToolCallResult>,
    container: &Container<'_>,
    group_id: Option<&str>,
    timing: Option<ToolCallTiming>,
) -> EncodedItem {
    EncodedItem::ToolCall {
        id: id.to_string(),
        title: name.to_string(),
        kind: category_to_kind(category),
        status: status_for(result),
        raw_input: json!(input),
        content: result_content(name, input, result),
        meta: wrap_meta(ItemMeta {
            group_id: group_id.map(str::to_string),
            tool_call_timing: timing,
            ..container.base_meta()
        }),
    }
}

/// `agent_id` doubles as the task group's stable id — it is the unique
/// tool_use id the subagent-launching tool call carried, not a synthesized
/// value (`display_helpers.rs` regression #184 comment: "use the unique
/// tool_use id, not description"). `subagent: true` marks that `title` is
/// the task description, not a tool name.
pub(super) fn task_group_item(
    agent_id: &str,
    task_args: &HashMap<String, Value>,
    result: &Option<ToolCallResult>,
    container: &Container<'_>,
    timing: Option<ToolCallTiming>,
) -> EncodedItem {
    let title = task_args
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("Subagent task")
        .to_string();
    EncodedItem::ToolCall {
        id: agent_id.to_string(),
        title,
        kind: ToolKind::Think,
        status: status_for(result),
        raw_input: json!(task_args),
        content: result_content("Task", task_args, result),
        meta: wrap_meta(ItemMeta {
            subagent: Some(true),
            tool_call_timing: timing,
            ..container.base_meta()
        }),
    }
}
