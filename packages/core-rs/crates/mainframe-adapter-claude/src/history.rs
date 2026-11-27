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
#[path = "history_parallel_budget.rs"]
mod budget;
#[path = "history_parallel.rs"]
mod parallel;

pub struct DiscoveredFiles {
    pub primary_path: String,
    pub all_files: Vec<String>,
    pub subagent_files: HashSet<String>,
    pub complete: bool,
}

impl DiscoveredFiles {
    pub(crate) fn parent_files(&self) -> impl Iterator<Item = &String> {
        self.all_files
            .iter()
            .take(1)
            .map(|_| &self.primary_path)
            .chain(
                self.all_files.iter().filter(|path| {
                    *path != &self.primary_path && !self.subagent_files.contains(*path)
                }),
            )
    }

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
) -> Result<Vec<ChatMessage>, mainframe_adapter_api::AdapterError> {
    load_history_with_index(session_id, project_path, session_file_path, None).await
}

pub(crate) async fn load_history_with_index(
    session_id: &str,
    project_path: &str,
    session_file_path: Option<&str>,
    index: Option<&crate::history_source_index::HistorySourceIndex>,
) -> Result<Vec<ChatMessage>, mainframe_adapter_api::AdapterError> {
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
        true,
    )
    .await
    .map(|(messages, _)| messages)
}
pub async fn load_history_in_dir(
    session_id: &str,
    project_dir: &str,
) -> Result<Vec<ChatMessage>, mainframe_adapter_api::AdapterError> {
    load_history_in_dir_with_index(session_id, project_dir, None).await
}

pub(crate) async fn load_history_in_dir_with_index(
    session_id: &str,
    project_dir: &str,
    index: Option<&crate::history_source_index::HistorySourceIndex>,
) -> Result<Vec<ChatMessage>, mainframe_adapter_api::AdapterError> {
    let discovered =
        history_discovery::discover_indexed_files_in_dir(session_id, project_dir, index).await;
    load_discovered_history(session_id, &discovered, project_dir, true)
        .await
        .map(|(messages, _)| messages)
}

#[path = "history_child.rs"]
mod history_child;
pub(crate) use history_child::load as load_child;
#[path = "history_agent_facts.rs"]
mod history_agent_facts;
#[path = "history_worker.rs"]
mod history_worker;
pub(crate) use history_worker::{load_discovered_history, load_history_window};

pub(crate) async fn run_history_worker<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, mainframe_adapter_api::AdapterError> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(worker_error)
}

pub(crate) fn worker_error(_: tokio::task::JoinError) -> mainframe_adapter_api::AdapterError {
    mainframe_adapter_api::AdapterError::Unavailable("Claude history worker failed")
}

pub(crate) async fn source_stamps(
    files: &[String],
) -> Option<Vec<mainframe_adapter_api::HistoryDependency>> {
    let mut stamps = Vec::new();
    for file in files {
        stamps.push(mainframe_adapter_api::HistoryDependency::capture(file.into()).await?);
    }
    stamps.sort_by(|a, b| a.path.cmp(&b.path));
    Some(stamps)
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
    turn_running: bool,
}
impl HistoryLoad {
    fn entry(&mut self, entry: &Value, session_id: &str, is_subagent_file: bool) {
        if !is_subagent_file {
            self.observe_turn_boundary(entry, session_id);
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

        let mut msg = match convert_history_entry(entry, session_id, &mut self.seen_api_message_ids)
        {
            Some(m) => m,
            None => return,
        };
        if self.seen_uuids.contains(&msg.id) {
            return;
        }
        self.seen_uuids.insert(msg.id.clone());
        self.classify_turn_entry(entry, &mut msg);
        self.messages.push(msg);
    }
    fn observe_turn_boundary(&mut self, entry: &Value, session_id: &str) {
        self.prompt_groups.observe(entry, session_id);
        if entry.get("type").and_then(Value::as_str) == Some("result") {
            self.turn_running = false;
        }
    }

    fn classify_turn_entry(&mut self, entry: &Value, message: &mut ChatMessage) {
        match entry.get("type").and_then(Value::as_str) {
            Some("attachment") if message.r#type == ChatMessageType::User => {
                if !self.turn_running
                    && let Some(meta) = &mut message.metadata
                {
                    meta.remove("steered");
                }
                self.turn_running = true;
            }
            Some("user") if message.r#type == ChatMessageType::User => {
                self.turn_running = true;
            }
            Some("assistant") => {
                self.prompt_groups.track(self.messages.len(), entry);
                let reason = entry
                    .get("message")
                    .and_then(|m| m.get("stop_reason"))
                    .and_then(Value::as_str);
                self.turn_running =
                    !matches!(reason, Some("end_turn" | "stop_sequence" | "max_tokens"));
            }
            _ => {}
        }
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

#[cfg(test)]
#[path = "history_queue_tests.rs"]
mod history_queue_tests;
#[cfg(test)]
#[path = "history_parallel_budget_tests.rs"]
mod parallel_budget_tests;
#[cfg(test)]
#[path = "history_parallel_fixture.rs"]
mod parallel_fixture;
#[cfg(test)]
#[path = "history_parallel_perf_tests.rs"]
mod parallel_perf_tests;
#[cfg(test)]
#[path = "history_parallel_tests.rs"]
mod parallel_tests;
