//! Ported from `packages/core/src/plugins/builtin/claude/history.ts`.
//!
//! Reads Claude's own JSONL transcripts (under `~/.claude/projects/<encoded>/`)
//! to reconstruct a chat's message history for resume, including subagent
//! (task_group) inlining. Also extracts plan- and skill-file paths from a
//! session's transcripts.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use dirs::home_dir;
use mainframe_types::chat::{ChatMessage, MessageContent};
use mainframe_types::context::SkillFileEntry;
use serde_json::Value;
use tokio::fs::File;
use tokio::io::{AsyncBufReadExt, BufReader, Lines};

use crate::history_converters::{
    convert_history_entry, synthesize_skill_loaded_from_user_entry,
    synthesize_unknown_command_from_user_entry,
};
use crate::history_subagents::{
    attach_subagent_tool_results, capture_agent_id_mapping, collect_agent_progress_tools,
    collect_subagent_assistant_blocks, collect_subagent_tool_results, inject_agent_children,
};
use crate::skill_path::resolve_skill_path;

fn is_strict_true(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::Bool(true)))
}

/// CLI parity: replace every char NOT in `[a-zA-Z0-9-]` with '-' (keeps dashes).
fn encode_project_path(project_path: &str) -> String {
    project_path
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

fn session_jsonl_path(session_id: &str, project_path: &str) -> (String, String) {
    let encoded = encode_project_path(project_path);
    let project_dir = home_dir()
        .unwrap_or_default()
        .join(".claude")
        .join("projects")
        .join(&encoded);
    let jsonl_path = project_dir.join(format!("{session_id}.jsonl"));
    (
        jsonl_path.to_string_lossy().to_string(),
        project_dir.to_string_lossy().to_string(),
    )
}

async fn open_lines(file_path: &str) -> Option<Lines<BufReader<File>>> {
    File::open(file_path)
        .await
        .ok()
        .map(|f| BufReader::new(f).lines())
}

pub struct DiscoveredFiles {
    pub primary_path: String,
    pub all_files: Vec<String>,
    pub subagent_files: HashSet<String>,
}

pub async fn discover_session_jsonl_files(session_id: &str, project_path: &str) -> DiscoveredFiles {
    let (jsonl_path, project_dir) = session_jsonl_path(session_id, project_path);

    if tokio::fs::metadata(&jsonl_path).await.is_err() {
        return DiscoveredFiles {
            primary_path: jsonl_path,
            all_files: Vec::new(),
            subagent_files: HashSet::new(),
        };
    }

    let mut jsonl_files = vec![jsonl_path.clone()];
    let mut subagent_files: HashSet<String> = HashSet::new();

    // Scan sibling .jsonl files (sidechains) with matching sessionId.
    let self_name = format!("{session_id}.jsonl");
    if let Ok(mut entries) = tokio::fs::read_dir(&project_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".jsonl") || name == self_name {
                continue;
            }
            let file_path = Path::new(&project_dir)
                .join(&name)
                .to_string_lossy()
                .to_string();
            if let Some(mut lines) = open_lines(&file_path).await {
                while let Ok(Some(line)) = lines.next_line().await {
                    if line.trim().is_empty() {
                        continue;
                    }
                    if let Ok(first) = serde_json::from_str::<Value>(&line)
                        && first.get("sessionId").and_then(Value::as_str) == Some(session_id)
                    {
                        jsonl_files.push(file_path.clone());
                    }
                    break; // only the first non-empty line
                }
            }
        }
    }

    // Scan subagent JSONL files.
    let subagent_dir = Path::new(&project_dir).join(session_id).join("subagents");
    if let Ok(mut sub_entries) = tokio::fs::read_dir(&subagent_dir).await {
        while let Ok(Some(entry)) = sub_entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".jsonl") {
                continue;
            }
            let file_path = subagent_dir.join(&name).to_string_lossy().to_string();
            jsonl_files.push(file_path.clone());
            subagent_files.insert(file_path);
        }
    }

    DiscoveredFiles {
        primary_path: jsonl_path,
        all_files: jsonl_files,
        subagent_files,
    }
}

pub async fn load_history(session_id: &str, project_path: &str) -> Vec<ChatMessage> {
    let discovered = discover_session_jsonl_files(session_id, project_path).await;
    if discovered.all_files.is_empty() {
        return Vec::new();
    }
    let subagent_files = &discovered.subagent_files;

    let mut messages: Vec<ChatMessage> = Vec::new();
    let mut agent_tools: HashMap<String, Vec<MessageContent>> = HashMap::new();
    let mut subagent_tool_results: HashMap<String, MessageContent> = HashMap::new();
    let mut seen_uuids: HashSet<String> = HashSet::new();
    // CLI 2.1.118+ subagent JSONLs omit parentToolUseID; the link lives on the
    // parent's tool_result via toolUseResult.agentId. Build that map while
    // walking the parent file so subagent processing can resolve the parent id.
    let mut agent_id_to_parent_tool_use_id: HashMap<String, String> = HashMap::new();

    for file in &discovered.all_files {
        let is_subagent_file = subagent_files.contains(file);
        let Some(mut lines) = open_lines(file).await else {
            // TODO(port): TS lets a mid-read stream error reject loadHistory; the
            // port skips an unreadable file (graceful) — files were just discovered.
            continue;
        };
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            tracing::trace!(module = "claude:history", session_id = %session_id, file = %file, line = %line, "[jsonl]");

            let entry: Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue, // skip malformed lines
            };

            // isMeta user messages carrying skill content are written to JSONL
            // only; synthesize a skill_loaded message before the isMeta filter.
            if is_strict_true(entry.get("isMeta"))
                && entry.get("type").and_then(Value::as_str) == Some("user")
                && !is_subagent_file
                && !is_strict_true(entry.get("isSidechain"))
                && let Some(synthesized) =
                    synthesize_skill_loaded_from_user_entry(&entry, session_id)
            {
                if !seen_uuids.contains(&synthesized.id) {
                    seen_uuids.insert(synthesized.id.clone());
                    messages.push(synthesized);
                }
                continue;
            }

            if is_strict_true(entry.get("isMeta")) {
                continue;
            }
            if is_strict_true(entry.get("isCompactSummary"))
                || is_strict_true(entry.get("isVisibleInTranscriptOnly"))
            {
                continue;
            }

            if is_subagent_file {
                collect_subagent_tool_results(&entry, &mut subagent_tool_results);
                collect_subagent_assistant_blocks(
                    &entry,
                    &mut agent_tools,
                    Some(&agent_id_to_parent_tool_use_id),
                );
                continue;
            }

            if entry.get("type").and_then(Value::as_str) == Some("user") {
                capture_agent_id_mapping(&entry, &mut agent_id_to_parent_tool_use_id);
            }

            if is_strict_true(entry.get("isSidechain")) {
                continue;
            }

            if entry.get("type").and_then(Value::as_str) == Some("user")
                && let Some(synthesized) =
                    synthesize_unknown_command_from_user_entry(&entry, session_id)
            {
                for m in synthesized {
                    if seen_uuids.contains(&m.id) {
                        continue;
                    }
                    seen_uuids.insert(m.id.clone());
                    messages.push(m);
                }
                continue;
            }

            if entry.get("type").and_then(Value::as_str) == Some("progress")
                && entry
                    .get("data")
                    .and_then(|d| d.get("type"))
                    .and_then(Value::as_str)
                    == Some("agent_progress")
            {
                collect_agent_progress_tools(&entry, &mut agent_tools);
                continue;
            }

            let msg = match convert_history_entry(&entry, session_id) {
                Some(m) => m,
                None => continue,
            };
            if seen_uuids.contains(&msg.id) {
                continue;
            }
            seen_uuids.insert(msg.id.clone());
            messages.push(msg);
        }
    }

    if !agent_tools.is_empty() {
        inject_agent_children(&mut messages, &agent_tools);
    }
    if !subagent_tool_results.is_empty() {
        attach_subagent_tool_results(&mut messages, &subagent_tool_results);
    }

    messages
}

pub async fn extract_plan_file_paths(session_id: &str, project_path: &str) -> Vec<String> {
    let discovered = discover_session_jsonl_files(session_id, project_path).await;
    if discovered.all_files.is_empty() {
        return Vec::new();
    }
    let (_, project_dir) = session_jsonl_path(session_id, project_path);
    let mut plan_files: Vec<String> = Vec::new();

    for file in &discovered.all_files {
        let Some(mut lines) = open_lines(file).await else {
            continue;
        };
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            let entry: Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if entry.get("type").and_then(Value::as_str) != Some("user") {
                continue;
            }
            let tur = entry.get("toolUseResult");
            let plan_is_string = tur
                .and_then(|t| t.get("plan"))
                .map(Value::is_string)
                .unwrap_or(false);
            let file_path = tur.and_then(|t| t.get("filePath")).and_then(Value::as_str);
            if plan_is_string && let Some(fp) = file_path {
                plan_files.push(path_resolve(&project_dir, fp));
            }
        }
    }

    plan_files
}

pub async fn extract_skill_file_paths(session_id: &str, project_path: &str) -> Vec<SkillFileEntry> {
    let discovered = discover_session_jsonl_files(session_id, project_path).await;
    if discovered.all_files.is_empty() {
        return Vec::new();
    }

    let mut seen: HashSet<String> = HashSet::new();
    let mut cache: HashMap<String, String> = HashMap::new();
    let mut skill_files: Vec<SkillFileEntry> = Vec::new();

    for file in &discovered.all_files {
        let Some(mut lines) = open_lines(file).await else {
            continue;
        };
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            let entry: Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if entry.get("type").and_then(Value::as_str) != Some("assistant") {
                continue;
            }
            let content = match entry
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(Value::as_array)
            {
                Some(c) => c,
                None => continue,
            };
            for block in content {
                if block.get("type").and_then(Value::as_str) == Some("tool_use")
                    && block.get("name").and_then(Value::as_str) == Some("Skill")
                    && let Some(skill) = block
                        .get("input")
                        .and_then(|i| i.get("skill"))
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty())
                {
                    push_skill_file(skill, project_path, &mut seen, &mut cache, &mut skill_files);
                }
            }
        }
    }

    skill_files
}

fn push_skill_file(
    name: &str,
    project_path: &str,
    seen: &mut HashSet<String>,
    cache: &mut HashMap<String, String>,
    skill_files: &mut Vec<SkillFileEntry>,
) {
    let trimmed = name.trim();
    if trimmed.is_empty() || seen.contains(trimmed) {
        return;
    }
    seen.insert(trimmed.to_string());
    skill_files.push(SkillFileEntry {
        path: resolve_skill_path(Some(project_path), trimmed, Some(cache)),
        display_name: trimmed.to_string(),
    });
}

/// Lexical `path.resolve(base, p)` for unix paths (no filesystem access):
/// returns `p` when absolute, else `base/p`, collapsing `.`/`..` segments.
fn path_resolve(base: &str, p: &str) -> String {
    let combined = if Path::new(p).is_absolute() {
        p.to_string()
    } else {
        format!("{base}/{p}")
    };
    let mut stack: Vec<&str> = Vec::new();
    for seg in combined.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                stack.pop();
            }
            s => stack.push(s),
        }
    }
    format!("/{}", stack.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_keeps_dashes_replaces_other_metachars() {
        assert_eq!(
            encode_project_path("/Users/x/my_proj.v2"),
            "-Users-x-my-proj-v2"
        );
        // existing dashes are preserved
        assert_eq!(encode_project_path("a-b/c"), "a-b-c");
    }

    #[test]
    fn path_resolve_absolute_passthrough() {
        assert_eq!(path_resolve("/proj/dir", "/abs/plan.md"), "/abs/plan.md");
    }

    #[test]
    fn path_resolve_joins_relative() {
        assert_eq!(
            path_resolve("/proj/dir", "plans/x.md"),
            "/proj/dir/plans/x.md"
        );
    }

    #[test]
    fn path_resolve_collapses_dotdot() {
        assert_eq!(path_resolve("/proj/dir", "../plan.md"), "/proj/plan.md");
    }

    #[tokio::test]
    async fn missing_session_returns_empty() {
        assert!(
            load_history("no-such-session-xyz", "/tmp/no-such-project-xyz")
                .await
                .is_empty()
        );
        assert!(
            extract_plan_file_paths("no-such-session-xyz", "/tmp/no-such-project-xyz")
                .await
                .is_empty()
        );
        assert!(
            extract_skill_file_paths("no-such-session-xyz", "/tmp/no-such-project-xyz")
                .await
                .is_empty()
        );
    }
}

// PORT STATUS: src/plugins/builtin/claude/history.ts (285 lines)
// confidence: high
// todos: 1
// notes: createReadStream+readline → tokio BufReader::lines() (CRLF-stripped).
// getSessionJsonlPath's encode uses [^a-zA-Z0-9-] (KEEPS dashes) — distinct from
// external-session-paths::encode_path ([^a-zA-Z0-9]). path.resolve is a lexical
// unix-only resolver (collapses ./..). loadHistory threads seen_uuids/agent_tools/
// subagent maps exactly as the TS; strict `=== true` vs `!== true` checks mapped
// to is_strict_true. The 1 TODO(port): TS lets a mid-read stream error reject the
// promise; the port skips an unreadable file (graceful) instead — files are just-
// discovered so this is an unlikely race. No TS __tests__ file for history.ts
// (its behavior is covered via history-converters); sanity tests cover encode +
// path_resolve + the empty-session short-circuit.
