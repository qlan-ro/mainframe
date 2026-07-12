//! Ported from `packages/core/src/plugins/builtin/claude/user-event.ts`.
//!
//! Handles user NDJSON events: queued-message replay acks, skill injections,
//! tool_result blocks (PR detection, plan-file capture), CLI-feedback text, and
//! the subagent (`parent_tool_use_id`) variant. The JS regexes are hand-rolled
//! (no `regex` crate in the allowlist).

use std::collections::HashMap;

use serde_json::{Value, json};

use mainframe_adapter_api::{LoadedSkill, SessionSink};
use mainframe_types::adapter::DetectedPrSource;
use mainframe_types::context::SkillFileEntry;

use crate::assistant_event::blocks_to_message_content;
use crate::history_tool_result::{build_tool_result_blocks, extract_tool_result_content};
use crate::pr_detection::{
    ToolUseMeta, extract_pr_from_tool_result, should_scan_tool_result_for_pr,
};
use crate::session::{ClaudeSession, ClaudeSessionState};
use crate::skill_path::{read_skill_content, resolve_existing_skill_path, resolve_skill_path};

/// Canonical preamble the CLI prepends to the synthesized post-compaction
/// "continuation" user message.
const COMPACT_SUMMARY_PREAMBLE: &str =
    "This session is being continued from a previous conversation that ran out of context";

/// A `skill_loaded` content block extracted from a text block.
struct SkillBlock {
    skill_name: String,
    path: String,
    content: String,
    parent_tool_use_id: Option<String>,
}

impl SkillBlock {
    fn to_value(&self) -> Value {
        let mut v = json!({
            "type": "skill_loaded",
            "skillName": self.skill_name,
            "path": self.path,
            "content": self.content,
        });
        if let Some(p) = &self.parent_tool_use_id {
            v["parentToolUseId"] = Value::String(p.clone());
        }
        v
    }
}

fn event_bool(event: &Value, keys: &[&str]) -> bool {
    keys.iter()
        .any(|k| event.get(*k).and_then(Value::as_bool) == Some(true))
}

/// `<command-name>\/?([^<]+)<\/command-name>` — capture (leading `/` stripped).
fn command_name(text: &str) -> Option<String> {
    let start = text.find("<command-name>")? + "<command-name>".len();
    let rest = &text[start..];
    let end = rest.find("</command-name>")?;
    let inner = &rest[..end];
    if inner.contains('<') {
        return None; // `[^<]+` forbids `<`
    }
    let inner = inner.strip_prefix('/').unwrap_or(inner).trim();
    if inner.is_empty() {
        None
    } else {
        Some(inner.to_string())
    }
}

/// `^Base directory for this skill:\s*(.+?)(?:\n|$)` (multiline) — the dir value.
fn base_dir(text: &str) -> Option<String> {
    const PREFIX: &str = "Base directory for this skill:";
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix(PREFIX) {
            let v = rest.trim();
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

/// Remove every `<tag>...</tag>` (content has no `<`) plus an optional trailing
/// newline — mirrors the TS `.replace(/<tag>[^<]*<\/tag>\n?/g, '')`.
fn strip_tag(text: &str, tag: &str) -> String {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let mut out = String::new();
    let mut rest = text;
    while let Some(i) = rest.find(&open) {
        let after_open = &rest[i + open.len()..];
        if let Some(j) = after_open.find(&close) {
            let inner = &after_open[..j];
            if !inner.contains('<') {
                out.push_str(&rest[..i]);
                let mut tail = &after_open[j + close.len()..];
                tail = tail.strip_prefix('\n').unwrap_or(tail);
                rest = tail;
                continue;
            }
        }
        // No clean match — emit up to and including the open tag, keep scanning.
        out.push_str(&rest[..i + open.len()]);
        rest = &rest[i + open.len()..];
    }
    out.push_str(rest);
    out
}

/// Remove the first line beginning with "Base directory for this skill:" plus its
/// trailing newline (mirrors `.replace(/^Base directory...[^\n]*\n?/m, '')`).
fn strip_base_dir_line(text: &str) -> String {
    const PREFIX: &str = "Base directory for this skill:";
    let mut result = String::with_capacity(text.len());
    let mut removed = false;
    let mut chars = text;
    while !chars.is_empty() {
        let line_end = chars.find('\n').map(|i| i + 1).unwrap_or(chars.len());
        let line = &chars[..line_end];
        if !removed && line.trim_end_matches('\n').starts_with(PREFIX) {
            removed = true; // drop this line (incl. its newline)
        } else {
            result.push_str(line);
        }
        chars = &chars[line_end..];
    }
    result
}

fn extract_skill_block(
    text: &str,
    project_path: &str,
    cache: &mut HashMap<String, String>,
    parent_tool_use_id: Option<&str>,
) -> Option<SkillBlock> {
    let has_skill_format = text.contains("<skill-format>true</skill-format>");
    let base_dir_match = base_dir(text);
    if !has_skill_format && base_dir_match.is_none() {
        return None;
    }

    let name_from_tag = command_name(text);
    let raw_dir = base_dir_match.unwrap_or_default();
    let skill_name = match name_from_tag {
        Some(n) => n,
        None => {
            if raw_dir.is_empty() {
                String::new()
            } else {
                std::path::Path::new(&raw_dir)
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default()
            }
        }
    };
    if skill_name.is_empty() {
        return None;
    }

    let resolved_path =
        if !raw_dir.is_empty() && std::path::Path::new(&raw_dir).extension().is_none() {
            std::path::Path::new(&raw_dir)
                .join("SKILL.md")
                .to_string_lossy()
                .to_string()
        } else {
            raw_dir.clone()
        };
    let final_path = if !resolved_path.is_empty() {
        resolved_path
    } else {
        resolve_skill_path(Some(project_path), &skill_name, Some(cache))
    };
    cache.insert(skill_name.clone(), final_path.clone());

    let content = strip_tag(text, "command-message");
    let content = strip_tag(&content, "command-name");
    let content = strip_tag(&content, "skill-format");
    let content = strip_base_dir_line(&content);
    let content = content.trim().to_string();

    Some(SkillBlock {
        skill_name,
        path: final_path,
        content,
        parent_tool_use_id: parent_tool_use_id.map(str::to_string),
    })
}

fn handle_subagent_user_event(
    event: &Value,
    project_path: &str,
    st: &mut ClaudeSessionState,
    parent_tool_use_id: &str,
    message: &Value,
    sink: &dyn SessionSink,
) {
    let mut collected: Vec<Value> = Vec::new();
    let content = message.get("content");

    if let Some(text) = content.and_then(Value::as_str) {
        // Pre-normalize edge case: treat as text, unless it's a
        // `<command-name>...</command-name>` skill echo.
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
            } else {
                collected.push(
                    json!({ "type": "text", "text": text, "parentToolUseId": parent_tool_use_id }),
                );
            }
        } else {
            collected.push(
                json!({ "type": "text", "text": text, "parentToolUseId": parent_tool_use_id }),
            );
        }
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
                    collected.push(json!({ "type": "text", "text": text, "parentToolUseId": parent_tool_use_id }));
                }
                // Image blocks intentionally skipped — same as the parent-level path.
            }
        }
    }

    if !collected.is_empty() {
        sink.on_subagent_child(parent_tool_use_id, blocks_to_message_content(&collected));
    }
}

/// `/^<local-command-(?:stdout|stderr|caveat)>[\s\S]*<\/local-command-(?:stdout|stderr|caveat)>\s*$/`
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

/// `/^\[Request interrupted by user[^\]]*\]\s*$/`
fn is_interrupt_marker(trimmed: &str) -> bool {
    const PREFIX: &str = "[Request interrupted by user";
    trimmed.starts_with(PREFIX)
        && trimmed.ends_with(']')
        && !trimmed[PREFIX.len()..trimmed.len() - 1].contains(']')
}

/// `/Your plan has been saved to: (\/\S+\.md)/` — the captured path.
fn plan_file_path(text: &str) -> Option<String> {
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

pub fn handle_user_event(session: &ClaudeSession, event: &Value, sink: &dyn SessionSink) {
    // Drop the post-compaction continuation user message (#150).
    if event.get("isCompactSummary").and_then(Value::as_bool) == Some(true) {
        return;
    }

    // Detect a queued message processed by the CLI (isReplay from SDK mode). The
    // uuid can land on the entry, message.uuid, or message.id (issue #147).
    let is_replay = event_bool(event, &["isReplay", "is_replay"]);
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

    let is_meta = event_bool(event, &["isMeta", "is_meta"]);
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

    // Subagent activity.
    if let Some(parent) = event
        .get("parent_tool_use_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        handle_subagent_user_event(event, &project_path, st, parent, message, sink);
        return;
    }

    // User-typed /skill-name path via a string-content metadata event.
    if let Some(text) = content.and_then(Value::as_str) {
        if let Some(skill_name) = command_name(text) {
            let cached = st.skill_path_cache.get(&skill_name).cloned();
            let skill_path =
                cached.or_else(|| resolve_existing_skill_path(Some(&project_path), &skill_name));
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

        // Any other string-content user event is CLI feedback.
        if !is_replay && !is_meta {
            let trimmed = text.trim();
            if !trimmed.is_empty() && !trimmed.starts_with(COMPACT_SUMMARY_PREAMBLE) {
                sink.on_cli_message(trimmed);
            }
        }
        return;
    }

    // Array content. Stream-json uses snake_case; JSONL uses camelCase.
    let tur = event
        .get("tool_use_result")
        .or_else(|| event.get("toolUseResult"));
    let tool_result_content = build_tool_result_blocks(message, tur);
    if !tool_result_content.is_empty() {
        sink.on_tool_result(tool_result_content);
    }

    let Some(blocks) = content.and_then(Value::as_array) else {
        return;
    };
    for block in blocks {
        let ty = block.get("type").and_then(Value::as_str);
        if ty == Some("tool_result") {
            let text = extract_tool_result_content(block.get("content"));
            let tool_use_id = block.get("tool_use_id").and_then(Value::as_str);
            let plan_path = plan_file_path(&text);
            if let Some(p) = plan_path {
                sink.on_plan_file(p.trim());
            }
            // Path A — gated by originating tool.
            let meta = tool_use_id.and_then(|id| st.tool_use_registry.get(id));
            let meta = meta.map(|m| ToolUseMeta {
                name: &m.name,
                command: m.command.as_deref(),
            });
            if should_scan_tool_result_for_pr(meta.as_ref())
                && let Some(pr) = extract_pr_from_tool_result(&text)
            {
                let source = if tool_use_id
                    .map(|id| st.pending_pr_creates.contains(id))
                    .unwrap_or(false)
                {
                    DetectedPrSource::Created
                } else {
                    DetectedPrSource::Mentioned
                };
                if source == DetectedPrSource::Created
                    && let Some(id) = tool_use_id
                {
                    st.pending_pr_creates.remove(id);
                }
                sink.on_pr_detected(pr.with_source(source));
            }

            // Path B: command-arg-based mutation detection.
            if let Some(id) = tool_use_id
                && let Some(stashed) = st.pending_pr_mutations.remove(id)
                && block.get("is_error").and_then(Value::as_bool) != Some(true)
            {
                sink.on_pr_detected(stashed.with_source(DetectedPrSource::Mentioned));
            }
            if let Some(id) = tool_use_id {
                st.tool_use_registry.remove(id);
            }
        } else if ty == Some("text") {
            let text = block.get("text").and_then(Value::as_str).unwrap_or("");
            if text.trim().is_empty() {
                continue;
            }
            // Skill injection — checked regardless of isReplay/isMeta.
            if let Some(skill_block) =
                extract_skill_block(text, &project_path, &mut st.skill_path_cache, None)
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
                continue;
            }

            // CLI-synthesized feedback.
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
}

// PORT STATUS: src/plugins/builtin/claude/user-event.ts (283 lines)
// confidence: medium
// todos: 0
// notes: JS regexes hand-rolled (no regex crate): command_name, base_dir,
// notes: strip_tag/strip_base_dir_line (content cleaning), is_local_command_wrapper,
// notes: is_interrupt_marker, plan_file_path. Operates on the raw NDJSON Value.
// notes: The state lock is held across the handler (session sinks are synchronous
// notes: and never re-enter this session's state lock). isReplay/isMeta/uuid
// notes: resolution + the tool_result PR-detection Path A/B + skill-injection
// notes: branches ported line-for-line. Covered by claude-events.test.ts (subagent,
// notes: skill, CLI-feedback, compaction-suppression) which drive handle_stdout.
