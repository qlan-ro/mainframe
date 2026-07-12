//! Do-steps (contract §1): the four verbs (`ask_agent`, `ask_me`,
//! `run_action`, `notify`) and the two blocks (`if`, `repeat`).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::condition::{ConditionMatch, ConditionRow};
use super::form::AutomationFormField;
use super::is_false;
use super::template::ChipText;
use super::token::TokenRef;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Step {
    AskAgent(AskAgentStep),
    AskMe(AskMeStep),
    RunAction(RunActionStep),
    Notify(NotifyStep),
    If(IfBlock),
    Repeat(RepeatBlock),
}

impl Step {
    pub fn id(&self) -> &str {
        match self {
            Step::AskAgent(s) => &s.id,
            Step::AskMe(s) => &s.id,
            Step::RunAction(s) => &s.id,
            Step::Notify(s) => &s.id,
            Step::If(s) => &s.id,
            Step::Repeat(s) => &s.id,
        }
    }

    pub fn kind_name(&self) -> &'static str {
        match self {
            Step::AskAgent(_) => "ask_agent",
            Step::AskMe(_) => "ask_me",
            Step::RunAction(_) => "run_action",
            Step::Notify(_) => "notify",
            Step::If(_) => "if",
            Step::Repeat(_) => "repeat",
        }
    }

    pub fn keep_going(&self) -> bool {
        match self {
            Step::AskAgent(s) => s.keep_going,
            Step::AskMe(s) => s.keep_going,
            Step::RunAction(s) => s.keep_going,
            Step::Notify(s) => s.keep_going,
            Step::If(s) => s.keep_going,
            Step::Repeat(s) => s.keep_going,
        }
    }
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AskMeStep {
    pub id: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub keep_going: bool,
    pub title: String,
    pub fields: Vec<AutomationFormField>,
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
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotifyStep {
    pub id: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub keep_going: bool,
    pub message: ChipText,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IfBlock {
    pub id: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub keep_going: bool,
    #[serde(rename = "match")]
    pub match_mode: ConditionMatch,
    pub conditions: Vec<ConditionRow>,
    pub then: Vec<Step>,
    pub otherwise: Vec<Step>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepeatBlock {
    pub id: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub keep_going: bool,
    /// The list token to iterate (wire name `items`, not `over`).
    pub items: TokenRef,
    pub steps: Vec<Step>,
}

/// Recursively finds a step by id, descending into `if`'s then/otherwise and
/// `repeat`'s inner steps — the same tree shape the walk traverses (Node
/// parity: automation-domain/tokens.ts `findStepById`).
pub fn find_step_by_id<'a>(steps: &'a [Step], step_id: &str) -> Option<&'a Step> {
    for step in steps {
        if step.id() == step_id {
            return Some(step);
        }
        let nested = match step {
            Step::If(block) => find_step_by_id(&block.then, step_id)
                .or_else(|| find_step_by_id(&block.otherwise, step_id)),
            Step::Repeat(block) => find_step_by_id(&block.steps, step_id),
            _ => None,
        };
        if nested.is_some() {
            return nested;
        }
    }
    None
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T1.1), not a TS port
// confidence: high
// todos: 0
// notes: wire truth = packages/types/src/automation.ts; A9 attachments included.
