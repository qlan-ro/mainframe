//! The leaf verbs (`ask_agent`, `ask_me`, `run_action`, `notify`,
//! `set_variable`, `wait`) — split out of `step.rs` (300-line cap) once
//! Phase 4b's `ParallelBlock` pushed it over. Every block type (`if`,
//! `repeat`, `loop`, `retry`, `parallel`) stays in `step.rs`, next to the
//! `Step` enum they nest inside.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::form::AutomationFormField;
use super::is_false;
use super::template::ChipText;

/// Parks the run for a fixed delay, then resumes.
///
/// Resolution is the engine's 30 s sweep, not a timer: a wait resumes on the
/// first sweep at or after its `wake_at`, so short waits round up and a wait
/// costs nothing while parked. That also makes it restart-safe for free —
/// `wake_at` lives in the checkpoint, so a daemon restart mid-wait resumes on
/// schedule instead of losing the timer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WaitStep {
    pub id: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub keep_going: bool,
    pub seconds: u32,
}

/// A2: a declared key parsed from the agent's final JSON message, becoming a
/// named output alongside `result`/`chatId`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExpectedOutput {
    pub key: String,
    #[serde(rename = "type")]
    pub output_type: ExpectedOutputType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExpectedOutputType {
    Text,
    Number,
    List,
    Choice,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorktreeSpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_branch: Option<String>,
    pub branch_name: ChipText,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AskAgentStep {
    pub id: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub keep_going: bool,
    pub prompt: ChipText,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adapter_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree: Option<WorktreeSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_approve: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_minutes: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expects: Option<Vec<ExpectedOutput>>,
    /// A9: image/file paths handed to the agent session alongside the prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<String>>,
    /// The variable-name ordinal the editor minted for this step (M1). Stored
    /// rather than derived from position, so inserting a producer above this
    /// one cannot steal `$agent_result` from it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AskMeStep {
    pub id: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub keep_going: bool,
    pub title: String,
    pub fields: Vec<AutomationFormField>,
    /// Minted variable name — see [`AskAgentStep::output_name`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputAs {
    Text,
    Lines,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunActionStep {
    pub id: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub keep_going: bool,
    pub action_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential: Option<String>,
    /// Every param value is a ChipText, coerced at execution (no `ParamValue`).
    pub params: BTreeMap<String, ChipText>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_as: Option<OutputAs>,
    /// Minted variable name — see [`AskAgentStep::output_name`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotifyStep {
    pub id: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub keep_going: bool,
    pub message: ChipText,
}

/// Names a composed value so later steps can reach it as `$name`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetVariableStep {
    pub id: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub keep_going: bool,
    pub name: String,
    pub value: ChipText,
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T1.1), not a TS port
// confidence: high
// todos: 0
// notes: split out of step.rs (Phase 4b, 300-line cap); wire truth =
//        packages/types/src/automation.ts; A9 attachments included.
