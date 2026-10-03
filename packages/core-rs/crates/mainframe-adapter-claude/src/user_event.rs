use std::collections::HashMap;

use serde_json::{Value, json};

use mainframe_adapter_api::{LoadedSkill, SessionSink};
use mainframe_types::context::SkillFileEntry;

use crate::assistant_event::blocks_to_message_content;
use crate::history_tool_result::{build_tool_result_blocks, extract_tool_result_content};
use crate::session::{ClaudeSession, ClaudeSessionState};
use crate::skill_path::{read_skill_content, resolve_existing_skill_path, resolve_skill_path};
const COMPACT_SUMMARY_PREAMBLE: &str =
    "This session is being continued from a previous conversation that ran out of context";

fn is_local_command_wrapper(trimmed: &str) -> bool {
    const OPENS: [&str; 3] = [
        "<local-command-stdout>",
        "<local-command-stderr>",
        "<local-command-caveat>",
    ];
    const CLOSES: [&str; 3] = [
        "</local-command-stdout>",
        "</local-command-stderr>",
        "</local-command-caveat>",
    ];
    OPENS.iter().any(|o| trimmed.starts_with(o)) && CLOSES.iter().any(|c| trimmed.ends_with(c))
}
fn is_interrupt_marker(trimmed: &str) -> bool {
    const PREFIX: &str = "[Request interrupted by user";
    trimmed.starts_with(PREFIX)
        && trimmed.ends_with(']')
        && !trimmed[PREFIX.len()..trimmed.len() - 1].contains(']')
}

pub fn handle_user_event(session: &ClaudeSession, event: &Value, sink: &dyn SessionSink) {
    crate::transcript_presentation::observe_user(session, event, sink);
    if event.get("isCompactSummary").and_then(Value::as_bool) == Some(true) {
        return;
    }
    let is_replay = event_bool(event, &["isReplay", "is_replay"]);
    report_replay(session, event, sink, is_replay);
    let is_meta = event_bool(event, &["isMeta", "is_meta", "isSynthetic", "is_synthetic"]);
    let Some(message) = event.get("message") else {
        return;
    };
    let content = message.get("content");
    if content.is_none() {
        return;
    }

    let project_path = session.project_path.clone();
    let mut guard = session.state.lock().unwrap_or_else(|e| e.into_inner());
    let st: &mut ClaudeSessionState = &mut guard;
    if let Some(parent) = event
        .get("parent_tool_use_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        handle_subagent_user_event(event, &project_path, st, parent, message, sink);
        return;
    }
    if let Some(text) = content.and_then(Value::as_str) {
        handle_user_text(text, &project_path, st, sink, is_replay, is_meta);
        return;
    }
    handle_user_blocks(event, message, st, sink, &project_path, is_replay, is_meta);
}

#[path = "user_event_content.rs"]
mod content;
#[path = "user_event_tools.rs"]
mod tools;
use content::*;
use tools::*;

fn report_replay(session: &ClaudeSession, event: &Value, sink: &dyn SessionSink, is_replay: bool) {
    let message_obj = event.get("message");
    let uuid = event
        .get("uuid")
        .and_then(Value::as_str)
        .or_else(|| {
            message_obj
                .and_then(|m| m.get("uuid"))
                .and_then(Value::as_str)
        })
        .or_else(|| {
            message_obj
                .and_then(|m| m.get("id"))
                .and_then(Value::as_str)
        });
    if is_replay {
        if let Some(uuid) = uuid {
            sink.on_queued_processed(uuid);
        } else {
            tracing::warn!(
                session_id = %session.id,
                "isReplay user event without recognizable uuid — queued flag may strand"
            );
        }
    }
}

fn handle_user_text(
    text: &str,
    project_path: &str,
    st: &mut ClaudeSessionState,
    sink: &dyn SessionSink,
    is_replay: bool,
    is_meta: bool,
) {
    if let Some(skill_name) = command_name(text) {
        let cached = st.skill_path_cache.get(&skill_name).cloned();
        let skill_path =
            cached.or_else(|| resolve_existing_skill_path(Some(project_path), &skill_name));
        if let Some(skill_path) = skill_path {
            st.skill_path_cache
                .insert(skill_name.clone(), skill_path.clone());
            let body = read_skill_content(&skill_path).unwrap_or_default();
            sink.on_skill_loaded(LoadedSkill {
                skill_name: skill_name.clone(),
                path: skill_path.clone(),
                content: body,
            });
            sink.on_skill_file(SkillFileEntry {
                path: skill_path,
                display_name: skill_name,
            });
        }
        return;
    }
    if !is_replay && !is_meta {
        let trimmed = text.trim();
        if !trimmed.is_empty() && !trimmed.starts_with(COMPACT_SUMMARY_PREAMBLE) {
            sink.on_cli_message(trimmed);
        }
    }
}

fn handle_user_blocks(
    event: &Value,
    message: &Value,
    st: &mut ClaudeSessionState,
    sink: &dyn SessionSink,
    project_path: &str,
    is_replay: bool,
    is_meta: bool,
) {
    let content = message.get("content");
    let tur = event
        .get("tool_use_result")
        .or_else(|| event.get("toolUseResult"));
    let tool_result_content = build_tool_result_blocks(message, tur);
    if !tool_result_content.is_empty() {
        let vendor_id = event
            .get("uuid")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        sink.on_tool_result(tool_result_content, vendor_id);
    }

    let Some(blocks) = content.and_then(Value::as_array) else {
        return;
    };
    for block in blocks {
        handle_user_block(block, st, sink, project_path, is_replay, is_meta);
    }
}

fn handle_user_block(
    block: &Value,
    st: &mut ClaudeSessionState,
    sink: &dyn SessionSink,
    project_path: &str,
    is_replay: bool,
    is_meta: bool,
) {
    let ty = block.get("type").and_then(Value::as_str);
    if ty == Some("tool_result") {
        let text = extract_tool_result_content(block.get("content"));
        crate::workflow_events::link_launch(st, &text);
        let plan_path = plan_file_path(&text);
        if let Some(p) = plan_path {
            sink.on_plan_file(p.trim());
        }
    } else if ty == Some("text") {
        let text = block.get("text").and_then(Value::as_str).unwrap_or("");
        if text.trim().is_empty() {
            return;
        }
        if let Some(skill_block) =
            extract_skill_block(text, project_path, &mut st.skill_path_cache, None)
        {
            sink.on_skill_loaded(LoadedSkill {
                skill_name: skill_block.skill_name.clone(),
                path: skill_block.path.clone(),
                content: skill_block.content.clone(),
            });
            sink.on_skill_file(SkillFileEntry {
                path: skill_block.path,
                display_name: skill_block.skill_name,
            });
            return;
        }
        if !is_replay && !is_meta {
            let trimmed = text.trim();
            if !is_local_command_wrapper(trimmed)
                && !is_interrupt_marker(trimmed)
                && !trimmed.starts_with(COMPACT_SUMMARY_PREAMBLE)
            {
                sink.on_cli_message(trimmed);
            }
        }
    }
}
