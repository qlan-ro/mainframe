//! SQLite store on its own `<dataDir>/automations.db` (contract §3) — the
//! three contract tables only; engine state is derived, never cached in
//! extra tables (locked decision: scheduler state derived).

pub mod automation_store;
pub mod db;
pub mod interaction_store;
pub(crate) mod run_rows;
pub mod run_store;

pub use automation_store::AutomationStore;
pub use db::AutomationDb;
pub use interaction_store::InteractionStore;
pub use run_store::RunStore;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::domain::{AutomationDefinition, AutomationFormField, AutomationScope};
use crate::error::StoreError;

// Statuses/kinds are the canonical wire enums in `mainframe-types` (T9.1);
// the engine keeps its original local names via aliases.
pub use mainframe_types::automation::{
    AutomationInteractionStatus as InteractionStatus, AutomationRunStatus as RunStatus,
    AutomationStepStatus as StepStatus, AutomationTriggerKind as RunTriggerKind,
};

/// The statuses `RunStore::finalize` may set (a run never re-enters
/// `running|waiting` once finalized — A8).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalStatus {
    Succeeded,
    Failed,
    Cancelled,
}

impl TerminalStatus {
    pub fn run_status(self) -> RunStatus {
        match self {
            TerminalStatus::Succeeded => RunStatus::Succeeded,
            TerminalStatus::Failed => RunStatus::Failed,
            TerminalStatus::Cancelled => RunStatus::Cancelled,
        }
    }
}

/// The firing context frozen into the checkpoint at run start (contract §2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTriggerContext {
    pub kind: RunTriggerKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trigger_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scheduled_for: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
}

impl RunTriggerContext {
    pub fn manual() -> Self {
        Self {
            kind: RunTriggerKind::Manual,
            trigger_id: None,
            scheduled_for: None,
            payload: None,
        }
    }
}

/// One `stepRef` entry (contract §2). The Node engine writes
/// `outputs`/`error`/`startedAt`/`finishedAt` as explicit `null` (they are
/// `T | null` typed there), so those carry no `skip_serializing_if`;
/// `chatId`/`interactionId` are TS-optional and omitted when absent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointStep {
    pub step_id: String,
    pub kind: String,
    pub status: StepStatus,
    #[serde(default)]
    pub outputs: Option<serde_json::Map<String, Value>>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub started_at: Option<i64>,
    #[serde(default)]
    pub finished_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chat_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interaction_id: Option<String>,
}

/// Canonical checkpoint (contract §2). `definition` is the FROZEN snapshot
/// at run start — `advance()` re-walks this, never the live `automations`
/// row, so mid-run edits cannot shift stepRefs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationCheckpoint {
    pub definition: AutomationDefinition,
    pub trigger: RunTriggerContext,
    pub steps: BTreeMap<String, CheckpointStep>,
    #[serde(default)]
    pub wake_at: Option<i64>,
    #[serde(default)]
    pub error: Option<String>,
}

impl AutomationCheckpoint {
    pub fn new(definition: AutomationDefinition, trigger: RunTriggerContext) -> Self {
        Self {
            definition,
            trigger,
            steps: BTreeMap::new(),
            wake_at: None,
            error: None,
        }
    }

    /// Deduped chatIds off every ask_agent entry seen so far — notification
    /// links (contract Decision 4: "chatIds from checkpoint agent steps").
    pub fn agent_chat_ids(&self) -> Vec<String> {
        let mut chat_ids = Vec::new();
        for entry in self.steps.values() {
            if entry.kind == "ask_agent"
                && let Some(chat_id) = &entry.chat_id
                && !chat_ids.contains(chat_id)
            {
                chat_ids.push(chat_id.clone());
            }
        }
        chat_ids
    }
}

/// A5 — a run whose checkpoint has ANY step `waiting` reports `waiting`
/// regardless of `wakeAt` (ask_me waits carry a null wakeAt by design).
pub fn derive_run_status(checkpoint: &AutomationCheckpoint) -> RunStatus {
    if checkpoint.wake_at.is_some() {
        return RunStatus::Waiting;
    }
    let has_waiting_step = checkpoint
        .steps
        .values()
        .any(|step| step.status == StepStatus::Waiting);
    if has_waiting_step {
        RunStatus::Waiting
    } else {
        RunStatus::Running
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AutomationRecord {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub scope: AutomationScope,
    pub project_id: Option<String>,
    pub enabled: bool,
    pub definition: AutomationDefinition,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RunRecord {
    pub id: String,
    pub automation_id: String,
    pub status: RunStatus,
    pub checkpoint: AutomationCheckpoint,
    pub started_at: i64,
    pub finished_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct InteractionRecord {
    pub id: String,
    pub run_id: String,
    pub step_ref: String,
    pub title: String,
    pub fields: Vec<AutomationFormField>,
    pub status: InteractionStatus,
    pub created_at: i64,
    pub resolved_at: Option<i64>,
}

/// Parses a TEXT column holding a serde `snake_case` enum value.
pub(crate) fn parse_db_enum<T: serde::de::DeserializeOwned>(
    raw: &str,
    what: &'static str,
    id: &str,
) -> Result<T, StoreError> {
    serde_json::from_value(Value::String(raw.to_string())).map_err(|source| StoreError::Corrupt {
        what,
        id: id.to_string(),
        source,
    })
}

pub(crate) fn epoch_ms_now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod automation_store_tests;

#[cfg(test)]
mod db_tests;

#[cfg(test)]
mod interaction_store_tests;

#[cfg(test)]
mod run_status_tests;

#[cfg(test)]
mod run_store_tests;

#[cfg(test)]
mod test_support;

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T2.1-T2.2), not a TS port
// confidence: high
// todos: 0
// notes: checkpoint serde mirrors Node store/types.ts null-vs-omit exactly
//        (shared automations.db can be handed between engines on a flip).
