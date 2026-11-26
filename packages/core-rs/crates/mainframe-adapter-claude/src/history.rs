use std::collections::{HashMap, HashSet};
use std::path::Path;

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent};
use mainframe_types::context::SkillFileEntry;
use serde_json::Value;

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

#[path = "history_reader.rs"]
mod reader;
use reader::visit_lines;

pub struct DiscoveredFiles {
    pub primary_path: String,
    pub all_files: Vec<String>,
    pub subagent_files: HashSet<String>,
    pub complete: bool,
}

impl DiscoveredFiles {
    fn missing(primary_path: String) -> Self {
        Self {
            primary_path,
            all_files: Vec::new(),
            subagent_files: HashSet::new(),
            complete: false,
        }
    }
}

pub async fn load_history(
    session_id: &str,
    project_path: &str,
    session_file_path: Option<&str>,
) -> Vec<ChatMessage> {
    load_history_with_index(session_id, project_path, session_file_path, None).await
}

pub(crate) async fn load_history_with_index(
    session_id: &str,
    project_path: &str,
    session_file_path: Option<&str>,
    index: Option<&crate::history_source_index::HistorySourceIndex>,
) -> Vec<ChatMessage> {
    let discovered = history_discovery::discover_indexed_session_files(
        session_id,
        project_path,
        session_file_path,
        index,
    )
    .await;
    load_discovered_history(
        session_id,
        &discovered,
        &get_session_jsonl_path(session_id, project_path).project_dir,
        project_path,
        true,
    )
    .await
    .0
}
pub async fn load_history_in_dir(session_id: &str, project_dir: &str) -> Vec<ChatMessage> {
    load_history_in_dir_with_index(session_id, project_dir, None).await
}

pub(crate) async fn load_history_in_dir_with_index(
    session_id: &str,
    project_dir: &str,
    index: Option<&crate::history_source_index::HistorySourceIndex>,
) -> Vec<ChatMessage> {
    let discovered =
        history_discovery::discover_indexed_files_in_dir(session_id, project_dir, index).await;
    load_discovered_history(session_id, &discovered, project_dir, project_dir, true)
        .await
        .0
}

pub(crate) async fn load_discovered_history(
    session_id: &str,
    discovered: &DiscoveredFiles,
    base: &str,
    project: &str,
    messages: bool,
) -> (Vec<ChatMessage>, mainframe_adapter_api::HistoryFiles) {
    if discovered.all_files.is_empty() {
        return Default::default();
    }
    let mut paths = PathCollector::default();
    let mut load = HistoryLoad::default();
    let files = discovered.all_files.clone();
    let subagent_files = discovered.subagent_files.clone();
    let (session_id, base, project) = (session_id.to_owned(), base.to_owned(), project.to_owned());
    tokio::task::spawn_blocking(move || {
        for file in &files {
            let is_subagent = subagent_files.contains(file);
            visit_lines(file, |line| {
                let Ok(entry) = serde_json::from_slice(line.as_bytes()) else {
                    paths.observe_plan(line, &base);
                    return;
                };
                paths.observe(&entry, line, &base, &project);
                if messages {
                    load.entry(&entry, &session_id, is_subagent);
                }
            });
        }
        let rows = load.finish();
        (rows, paths.files)
    })
    .await
    .unwrap_or_default()
}

#[path = "history_discovery.rs"]
pub(crate) mod history_discovery;
#[cfg(test)]
#[path = "history_tests.rs"]
mod tests;
pub(crate) use history_discovery::*;
#[path = "history_paths.rs"]
mod history_paths;
pub(crate) use history_paths::*;
#[path = "history_prompt_groups.rs"]
pub(crate) mod history_prompt_groups;
use history_prompt_groups::PromptGroups;

#[derive(Default)]
struct HistoryLoad {
    messages: Vec<ChatMessage>,
    agent_tools: HashMap<String, Vec<MessageContent>>,
    subagent_tool_results: HashMap<String, MessageContent>,
    seen_uuids: HashSet<String>,
    seen_api_message_ids: HashSet<String>,
    agent_id_to_parent_tool_use_id: HashMap<String, String>,
    prompt_groups: PromptGroups,
}
impl HistoryLoad {
    fn entry(&mut self, entry: &Value, session_id: &str, is_subagent_file: bool) {
        if !is_subagent_file {
            self.prompt_groups.observe(entry, session_id);
        }
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
        if msg.r#type == ChatMessageType::Assistant {
            self.prompt_groups.track(self.messages.len(), entry);
        }
        self.messages.push(msg);
    }
    fn finish(mut self) -> Vec<ChatMessage> {
        std::mem::take(&mut self.prompt_groups).apply(&mut self.messages);
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
