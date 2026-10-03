use super::*;
pub(super) fn scan_tools(
    session: &ClaudeSession,
    st: &mut ClaudeSessionState,
    content: &[Value],
    sink: &dyn SessionSink,
) {
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
        if !id.is_empty() && !name.is_empty() && !st.mainframe_chat_id.is_empty() {
            st.task_events.capture_tool_use(id, name, input);
        }

        scan_skill(session, st, name, input, sink);
    }
}
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

fn scan_skill(
    session: &ClaudeSession,
    st: &mut ClaudeSessionState,
    name: &str,
    input: Option<&Value>,
    sink: &dyn SessionSink,
) {
    if name == "Skill" {
        let skill_name = input
            .and_then(|i| i.get("skill"))
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        if !skill_name.is_empty() {
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
