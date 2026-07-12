//! Ported from `packages/core/src/plugins/builtin/claude/assistant-event.ts`.
//!
//! Operates on the raw NDJSON `Value` (as the TS does on loose objects) and calls
//! the `SessionSink`. Typed `MessageContent` is produced only where a sink method
//! demands it (via `serde_json::from_value`), matching the TS `MessageContent[]`
//! passed to `onMessage` / `onSubagentChild`.

use serde_json::Value;

use mainframe_adapter_api::SessionSink;
use mainframe_services::todos::normalize::{TodoSource, normalize_todos};
use mainframe_types::adapter::{MessageMetadata, MessageUsage};
use mainframe_types::chat::{MessageContent, TodoItem};
use mainframe_types::context::SkillFileEntry;

use crate::pr_detection::{
    is_pr_create_command, is_pr_mutation_command, parse_pr_identifier_from_args,
};
use crate::session::{ClaudeSession, ClaudeSessionState, ToolUseRegistryEntry};
use crate::skill_path::resolve_skill_path;

/// Deserialize loose content blocks into typed `MessageContent`, skipping (with a
/// one-line warn) any block the union can't represent — the CLI only emits known
/// block types, so this is defensive.
pub(crate) fn blocks_to_message_content(blocks: &[Value]) -> Vec<MessageContent> {
    blocks
        .iter()
        .filter_map(
            |b| match serde_json::from_value::<MessageContent>(b.clone()) {
                Ok(mc) => Some(mc),
                Err(err) => {
                    tracing::warn!(
                        ?err,
                        "assistant event: unrepresentable content block skipped"
                    );
                    None
                }
            },
        )
        .collect()
}

fn tag_block(block: &Value, parent_tool_use_id: &str) -> Value {
    let mut b = block.clone();
    if let Value::Object(map) = &mut b {
        map.insert(
            "parentToolUseId".to_string(),
            Value::String(parent_tool_use_id.to_string()),
        );
    }
    b
}

pub fn handle_assistant_event(session: &ClaudeSession, event: &Value, sink: &dyn SessionSink) {
    let message = event.get("message");
    let usage = message.and_then(|m| m.get("usage"));

    let mut guard = session.state.lock().unwrap_or_else(|e| e.into_inner());
    let st: &mut ClaudeSessionState = &mut guard;

    if let Some(u) = usage {
        st.last_assistant_usage = serde_json::from_value::<MessageUsage>(u.clone()).ok();
    }
    let Some(content) = message
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
    else {
        return;
    };

    // Subagent activity: tag every block and forward via onSubagentChild.
    if let Some(parent) = event
        .get("parent_tool_use_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        let tagged: Vec<Value> = content.iter().map(|b| tag_block(b, parent)).collect();
        let blocks = blocks_to_message_content(&tagged);
        drop(guard);
        sink.on_subagent_child(parent, blocks);
        return;
    }

    for block in content {
        if block.get("type").and_then(Value::as_str) != Some("tool_use") {
            continue;
        }
        let name = block.get("name").and_then(Value::as_str).unwrap_or("");
        let input = block.get("input");

        if name == "TodoWrite"
            && let Some(todos) = input.and_then(|i| i.get("todos")).and_then(Value::as_array)
        {
            let valid: Vec<TodoItem> = todos
                .iter()
                .filter(|t| {
                    t.is_object()
                        && t.get("content").and_then(Value::as_str).is_some()
                        && t.get("status").and_then(Value::as_str).is_some()
                })
                // The typed TodoItem requires activeForm + a valid status; a
                // bad/missing field drops the item (same precedent as
                // mainframe-services::todos::normalize).
                .filter_map(|t| serde_json::from_value::<TodoItem>(t.clone()).ok())
                .collect();
            if !valid.is_empty() {
                sink.on_todo_update(valid);
            }
        }

        if matches!(name, "TaskCreate" | "TaskUpdate" | "TaskStop") {
            handle_task_v2_event(st, name, input.unwrap_or(&Value::Null), sink);
        }

        let id = block.get("id").and_then(Value::as_str).unwrap_or("");
        if !id.is_empty() && !name.is_empty() {
            let command = input
                .and_then(|i| i.get("command"))
                .and_then(Value::as_str)
                .map(str::to_string);
            st.tool_use_registry.insert(
                id.to_string(),
                ToolUseRegistryEntry {
                    name: name.to_string(),
                    command,
                },
            );
            if !st.mainframe_chat_id.is_empty() {
                st.task_events.capture_tool_use(id, name, input);
            }
        }

        if (name == "Bash" || name == "BashTool")
            && let Some(command) = input.and_then(|i| i.get("command")).and_then(Value::as_str)
        {
            if is_pr_create_command(command) {
                st.pending_pr_creates.insert(id.to_string());
            }
            if is_pr_mutation_command(command)
                && let Some(pr) = parse_pr_identifier_from_args(command)
            {
                st.pending_pr_mutations.insert(id.to_string(), pr);
            }
        }

        if name == "Skill" {
            let skill_name = input
                .and_then(|i| i.get("skill"))
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or("");
            if !skill_name.is_empty() {
                // Use the cached path from a prior user-event, falling back to the probe.
                let cached = st.skill_path_cache.get(skill_name).cloned();
                let resolved = match cached {
                    Some(p) => p,
                    None => resolve_skill_path(
                        Some(&session.project_path),
                        skill_name,
                        Some(&mut st.skill_path_cache),
                    ),
                };
                sink.on_skill_file(SkillFileEntry {
                    path: resolved,
                    display_name: skill_name.to_string(),
                });
            }
        }
    }

    let metadata = MessageMetadata {
        model: message
            .and_then(|m| m.get("model"))
            .and_then(Value::as_str)
            .map(str::to_string),
        usage: usage.and_then(|u| serde_json::from_value::<MessageUsage>(u.clone()).ok()),
    };
    let blocks = blocks_to_message_content(content);
    drop(guard);
    sink.on_message(blocks, Some(metadata));
}

/// Accumulate a V2 task event and emit `onTodoUpdate` with the current snapshot.
fn handle_task_v2_event(
    st: &mut ClaudeSessionState,
    tool_name: &str,
    input: &Value,
    sink: &dyn SessionSink,
) {
    st.task_v2_events.push(serde_json::json!({
        "toolName": tool_name,
        "args": input,
    }));
    let payload = Value::Array(st.task_v2_events.clone());
    let todos = normalize_todos(TodoSource::TaskV2, &payload);
    if !todos.is_empty() {
        sink.on_todo_update(todos);
    }
}

// PORT STATUS: src/plugins/builtin/claude/assistant-event.ts (108 lines)
// confidence: high
// todos: 0
// notes: operates on the raw NDJSON Value (loose, like TS), producing typed
// notes: MessageContent only for onMessage/onSubagentChild via from_value.
// notes: TodoWrite filter deserializes to TodoItem (drops items missing
// notes: activeForm / with a bad status) — same precedent as
// notes: mainframe-services::todos::normalize. handleTaskV2Event routes through
// notes: normalize_todos(TaskV2, [{toolName,args}...]). The state lock is held
// notes: across the loop (session sinks are synchronous, non-awaiting, and never
// notes: re-enter this session's state lock) and dropped before the final
// notes: onMessage / onSubagentChild for cleanliness.
