use super::*;
pub(super) fn handle_subagent_user_event(
    event: &Value,
    project_path: &str,
    st: &mut ClaudeSessionState,
    parent_tool_use_id: &str,
    message: &Value,
    sink: &dyn SessionSink,
) {
    let is_synthetic = event_bool(event, &["isMeta", "is_meta", "isSynthetic", "is_synthetic"]);
    let mut collected: Vec<Value> = Vec::new();
    let content = message.get("content");
    if let Some(text) = content.and_then(Value::as_str) {
        collect_string(
            text,
            project_path,
            st,
            parent_tool_use_id,
            is_synthetic,
            &mut collected,
        );
    } else {
        let tur = event
            .get("tool_use_result")
            .or_else(|| event.get("toolUseResult"));
        for r in build_tool_result_blocks(message, tur) {
            let mut v = serde_json::to_value(&r).unwrap_or(Value::Null);
            if let Value::Object(map) = &mut v {
                map.insert(
                    "parentToolUseId".to_string(),
                    Value::String(parent_tool_use_id.to_string()),
                );
            }
            collected.push(v);
        }
        if let Some(blocks) = content.and_then(Value::as_array) {
            collect_blocks(
                blocks,
                project_path,
                st,
                parent_tool_use_id,
                is_synthetic,
                &mut collected,
            );
        }
    }
    if !collected.is_empty() {
        sink.on_subagent_child(parent_tool_use_id, blocks_to_message_content(&collected));
    }
}
pub(super) fn plan_file_path(text: &str) -> Option<String> {
    const MARKER: &str = "Your plan has been saved to: ";
    let i = text.find(MARKER)? + MARKER.len();
    let rest = &text[i..];
    if !rest.starts_with('/') {
        return None;
    }
    let path: String = rest.chars().take_while(|c| !c.is_whitespace()).collect();
    if path.ends_with(".md") {
        Some(path)
    } else {
        None
    }
}

fn collect_string(
    text: &str,
    project_path: &str,
    st: &mut ClaudeSessionState,
    parent_tool_use_id: &str,
    is_synthetic: bool,
    collected: &mut Vec<Value>,
) {
    if let Some(skill_name) = command_name(text) {
        let cached = st.skill_path_cache.get(&skill_name).cloned();
        let skill_path =
            cached.or_else(|| resolve_existing_skill_path(Some(project_path), &skill_name));
        if let Some(skill_path) = skill_path {
            st.skill_path_cache
                .insert(skill_name.clone(), skill_path.clone());
            let body = read_skill_content(&skill_path).unwrap_or_default();
            collected.push(json!({
                "type": "skill_loaded",
                "skillName": skill_name,
                "path": skill_path,
                "content": body,
                "parentToolUseId": parent_tool_use_id,
            }));
        } else if !is_synthetic {
            collected.push(
                json!({ "type": "text", "text": text, "parentToolUseId": parent_tool_use_id }),
            );
        }
    } else if !is_synthetic {
        collected
            .push(json!({ "type": "text", "text": text, "parentToolUseId": parent_tool_use_id }));
    }
}

fn collect_blocks(
    blocks: &[Value],
    project_path: &str,
    st: &mut ClaudeSessionState,
    parent_tool_use_id: &str,
    is_synthetic: bool,
    collected: &mut Vec<Value>,
) {
    for block in blocks {
        let ty = block.get("type").and_then(Value::as_str);
        if ty == Some("tool_result") {
            continue; // already handled above
        }
        if ty == Some("text") {
            let text = block.get("text").and_then(Value::as_str).unwrap_or("");
            if text.trim().is_empty() {
                continue;
            }
            if let Some(skill_block) = extract_skill_block(
                text,
                project_path,
                &mut st.skill_path_cache,
                Some(parent_tool_use_id),
            ) {
                collected.push(skill_block.to_value());
                continue;
            }
            if !is_synthetic {
                collected.push(
                    json!({ "type": "text", "text": text, "parentToolUseId": parent_tool_use_id }),
                );
            }
        }
    }
}
