use std::collections::{HashMap, HashSet};
use std::path::Path;

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
use crate::transcript::{SessionJsonlPath, get_session_jsonl_path, locate_claude_transcript};
use mainframe_types::transcript::TranscriptLocation;

fn is_strict_true(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::Bool(true)))
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

impl DiscoveredFiles {
    fn missing(primary_path: String) -> Self {
        Self {
            primary_path,
            all_files: Vec::new(),
            subagent_files: HashSet::new(),
        }
    }
}

pub async fn load_history(
    session_id: &str,
    project_path: &str,
    session_file_path: Option<&str>,
) -> Vec<ChatMessage> {
    let discovered =
        discover_session_jsonl_files(session_id, project_path, session_file_path).await;
    load_discovered_history(session_id, &discovered).await
}
pub async fn load_history_in_dir(session_id: &str, project_dir: &str) -> Vec<ChatMessage> {
    let discovered = discover_session_jsonl_files_in_dir(session_id, project_dir).await;
    load_discovered_history(session_id, &discovered).await
}

async fn load_discovered_history(
    session_id: &str,
    discovered: &DiscoveredFiles,
) -> Vec<ChatMessage> {
    if discovered.all_files.is_empty() {
        return Vec::new();
    }
    let subagent_files = &discovered.subagent_files;

    let mut load = HistoryLoad::default();
    for file in &discovered.all_files {
        let is_subagent_file = subagent_files.contains(file);
        let Some(mut lines) = open_lines(file).await else {
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
            load.entry(&entry, session_id, is_subagent_file);
        }
    }

    load.finish()
}

#[path = "history_discovery.rs"]
mod history_discovery;
#[cfg(test)]
#[path = "history_tests.rs"]
mod tests;
pub(crate) use history_discovery::*;
#[path = "history_paths.rs"]
mod history_paths;
pub(crate) use history_paths::*;

#[derive(Default)]
struct HistoryLoad {
    messages: Vec<ChatMessage>,
    agent_tools: HashMap<String, Vec<MessageContent>>,
    subagent_tool_results: HashMap<String, MessageContent>,
    seen_uuids: HashSet<String>,
    seen_api_message_ids: HashSet<String>,
    agent_id_to_parent_tool_use_id: HashMap<String, String>,
}
impl HistoryLoad {
    fn entry(&mut self, entry: &Value, session_id: &str, is_subagent_file: bool) {
        if self.filtered(entry, session_id, is_subagent_file) {
            return;
        }
        if entry.get("type").and_then(Value::as_str) == Some("user") {
            capture_agent_id_mapping(entry, &mut self.agent_id_to_parent_tool_use_id);
        }

        if is_strict_true(entry.get("isSidechain")) {
            return;
        }

        if entry.get("type").and_then(Value::as_str) == Some("user")
            && let Some(synthesized) = synthesize_unknown_command_from_user_entry(entry, session_id)
        {
            for m in synthesized {
                if self.seen_uuids.contains(&m.id) {
                    continue;
                }
                self.seen_uuids.insert(m.id.clone());
                self.messages.push(m);
            }
            return;
        }

        if entry.get("type").and_then(Value::as_str) == Some("progress")
            && entry
                .get("data")
                .and_then(|d| d.get("type"))
                .and_then(Value::as_str)
                == Some("agent_progress")
        {
            collect_agent_progress_tools(entry, &mut self.agent_tools);
            return;
        }

        let msg = match convert_history_entry(entry, session_id, &mut self.seen_api_message_ids) {
            Some(m) => m,
            None => return,
        };
        if self.seen_uuids.contains(&msg.id) {
            return;
        }
        self.seen_uuids.insert(msg.id.clone());
        self.messages.push(msg);
    }
    fn finish(mut self) -> Vec<ChatMessage> {
        if !self.agent_tools.is_empty() {
            inject_agent_children(&mut self.messages, &self.agent_tools);
        }
        if !self.subagent_tool_results.is_empty() {
            attach_subagent_tool_results(&mut self.messages, &self.subagent_tool_results);
        }

        self.messages
    }
}

impl HistoryLoad {
    fn filtered(&mut self, entry: &Value, session_id: &str, is_subagent_file: bool) -> bool {
        if is_strict_true(entry.get("isMeta"))
            && entry.get("type").and_then(Value::as_str) == Some("user")
            && !is_subagent_file
            && !is_strict_true(entry.get("isSidechain"))
            && let Some(synthesized) = synthesize_skill_loaded_from_user_entry(entry, session_id)
        {
            if !self.seen_uuids.contains(&synthesized.id) {
                self.seen_uuids.insert(synthesized.id.clone());
                self.messages.push(synthesized);
            }
            return true;
        }

        if is_strict_true(entry.get("isMeta")) {
            return true;
        }
        if is_strict_true(entry.get("isCompactSummary"))
            || is_strict_true(entry.get("isVisibleInTranscriptOnly"))
        {
            return true;
        }

        if is_subagent_file {
            collect_subagent_tool_results(entry, &mut self.subagent_tool_results);
            collect_subagent_assistant_blocks(
                entry,
                &mut self.agent_tools,
                Some(&self.agent_id_to_parent_tool_use_id),
            );
            return true;
        }

        false
    }
}
