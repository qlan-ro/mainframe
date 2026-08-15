//! Adapter-neutral live PR scanning (todo #339, task 10). Mirrors the Claude
//! adapter's Path-A/Path-B scan (`assistant_event.rs:143-172`,
//! `user_event.rs:433-467`) in terms every adapter's canonical tool-use /
//! tool-result stream already carries: tool name, command text, tool-result
//! text and its error flag.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use mainframe_types::adapter::{DetectedPr, DetectedPrSource};

use super::DetectedPrCore;
use super::command::{
    ToolUseMeta, is_pr_create_command, is_pr_mutation_command, parse_pr_identifier_from_args,
    should_scan_tool_result_for_pr,
};
use super::parse::extract_pr_from_tool_result;

/// Metadata recorded for a tool_use block: name plus (for `Bash`/`BashTool`)
/// its command text — the only fields Path A/B need.
struct ToolMeta {
    name: String,
    command: Option<String>,
}

/// Live PR scan state for one session's tool traffic. Holds no adapter-
/// specific types, so it applies unchanged to Claude, Codex, the mock, and
/// any future adapter that reports shell commands through the canonical
/// stream.
#[derive(Default)]
pub struct LivePrScanner {
    tool_meta: HashMap<String, ToolMeta>,
    pending_creates: HashSet<String>,
    pending_mutations: HashMap<String, DetectedPrCore>,
}

impl LivePrScanner {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records a tool_use block's metadata and, for a `Bash`/`BashTool` PR
    /// command, registers it as a pending create and/or mutation. Mirrors
    /// `assistant_event.rs:143-172`.
    pub fn observe_tool_use(&mut self, id: &str, name: &str, input: &HashMap<String, Value>) {
        if id.is_empty() || name.is_empty() {
            return;
        }
        let command = input
            .get("command")
            .and_then(Value::as_str)
            .map(str::to_string);

        if (name == "Bash" || name == "BashTool")
            && let Some(command) = &command
        {
            if is_pr_create_command(command) {
                self.pending_creates.insert(id.to_string());
            }
            if is_pr_mutation_command(command)
                && let Some(pr) = parse_pr_identifier_from_args(command)
            {
                self.pending_mutations.insert(id.to_string(), pr);
            }
        }

        self.tool_meta.insert(
            id.to_string(),
            ToolMeta {
                name: name.to_string(),
                command,
            },
        );
    }

    /// Consumes a tool_result for `tool_use_id`, evicting its recorded meta
    /// regardless of outcome. Mirrors `user_event.rs:433-467`.
    pub fn observe_tool_result(
        &mut self,
        tool_use_id: &str,
        text: &str,
        is_error: bool,
    ) -> Vec<DetectedPr> {
        let meta = self.tool_meta.remove(tool_use_id);
        let mut hits = Vec::new();

        if let Some(pr) = self.scan_path_a(tool_use_id, meta.as_ref(), text) {
            hits.push(pr);
        }
        if let Some(pr) = self.scan_path_b(tool_use_id, is_error) {
            hits.push(pr);
        }
        hits
    }

    /// Path A — gated by the originating tool: `Bash`/`BashTool` running a
    /// PR-relevant command, or an `Agent`/`Task` result.
    fn scan_path_a(
        &mut self,
        tool_use_id: &str,
        meta: Option<&ToolMeta>,
        text: &str,
    ) -> Option<DetectedPr> {
        let gate = meta.map(|m| ToolUseMeta {
            name: &m.name,
            command: m.command.as_deref(),
        });
        if !should_scan_tool_result_for_pr(gate.as_ref()) {
            return None;
        }
        let pr = extract_pr_from_tool_result(text)?;
        let source = if self.pending_creates.remove(tool_use_id) {
            DetectedPrSource::Created
        } else {
            DetectedPrSource::Mentioned
        };
        Some(pr.with_source(source))
    }

    /// Path B — a stashed mutation command's PR identifier, confirmed by a
    /// non-error result.
    fn scan_path_b(&mut self, tool_use_id: &str, is_error: bool) -> Option<DetectedPr> {
        let stashed = self.pending_mutations.remove(tool_use_id)?;
        if is_error {
            return None;
        }
        Some(stashed.with_source(DetectedPrSource::Mentioned))
    }
}
