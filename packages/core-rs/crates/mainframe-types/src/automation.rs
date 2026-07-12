//! Automations v2 wire projections (packages/types/src/automation.ts).
//!
//! Only the surface the daemon wire needs lives here: run/interaction
//! summaries (the §4 WS event payloads + REST bodies), the timeline entry,
//! and their status enums. The full definition domain model (steps,
//! triggers, chips) is engine-side in `mainframe-automations`, which
//! re-exports these types so there is a single canonical definition of each
//! wire shape (contract: docs/plans/2026-07-12-automations-v2-contract.md).

use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Run statuses (contract §1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationRunStatus {
    Running,
    Waiting,
    Succeeded,
    Failed,
    Cancelled,
}

impl AutomationRunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            AutomationRunStatus::Running => "running",
            AutomationRunStatus::Waiting => "waiting",
            AutomationRunStatus::Succeeded => "succeeded",
            AutomationRunStatus::Failed => "failed",
            AutomationRunStatus::Cancelled => "cancelled",
        }
    }

    /// A8 — terminal runs are immutable.
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            AutomationRunStatus::Succeeded
                | AutomationRunStatus::Failed
                | AutomationRunStatus::Cancelled
        )
    }
}

impl fmt::Display for AutomationRunStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Checkpoint step statuses (contract §2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationStepStatus {
    Running,
    Succeeded,
    Failed,
    Waiting,
    Skipped,
}

/// Interaction statuses (contract §1) — no expiry in v2.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationInteractionStatus {
    Pending,
    Answered,
    Cancelled,
}

impl AutomationInteractionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            AutomationInteractionStatus::Pending => "pending",
            AutomationInteractionStatus::Answered => "answered",
            AutomationInteractionStatus::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationTriggerKind {
    Schedule,
    Event,
    Webhook,
    Manual,
}

/// `automation.completed`'s status field — only real terminal outcomes;
/// cancelled runs never emit a completion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationCompletedStatus {
    Succeeded,
    Failed,
}

/// Ask-me form field types (contract §1): five types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationFormFieldType {
    Text,
    Number,
    Choice,
    Multi,
    Textarea,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutomationShowWhen {
    pub key: String,
    pub equals: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutomationFormField {
    pub key: String,
    #[serde(rename = "type")]
    pub field_type: AutomationFormFieldType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<String>>,
    /// Tri-state on purpose (Node `required !== false`): an ABSENT
    /// `required` still means required — only an explicit `false` opts out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_when: Option<AutomationShowWhen>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunTrigger {
    pub kind: AutomationTriggerKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens: Option<Value>,
}

/// Wire projection of a run (TS `AutomationRunSummary`): `finishedAt`/`error`
/// are `T | null` there, so no omit-when-absent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunSummary {
    pub id: String,
    pub automation_id: String,
    pub status: AutomationRunStatus,
    pub trigger: AutomationRunTrigger,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub error: Option<String>,
}

/// Wire projection of an interaction (TS `AutomationInteractionSummary`):
/// `resolvedAt` is `number | null` there, so no omit-when-absent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationInteractionSummary {
    pub id: String,
    pub run_id: String,
    pub step_ref: String,
    pub title: String,
    pub fields: Vec<AutomationFormField>,
    pub status: AutomationInteractionStatus,
    pub created_at: i64,
    pub resolved_at: Option<i64>,
}

/// `automation.notification`'s `links` payload (contract §4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationNotificationLinks {
    pub run_id: String,
    pub chat_ids: Vec<String>,
}

/// One `GET /api/automation-runs/:id` timeline entry (TS
/// `AutomationTimelineEntry`): optionals are TS-optional, omitted when
/// absent — except `error`, which Node projects as `T | null`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationTimelineEntry {
    pub step_ref: String,
    pub step_id: String,
    pub kind: String,
    pub status: AutomationStepStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_preview: Option<String>,
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chat_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interaction_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<i64>,
}

// PORT STATUS: packages/types/src/automation.ts (summaries/timeline/enums only)
// confidence: high
// todos: 0
// notes: definition domain types (steps/triggers/chips) deliberately stay in
// mainframe-automations::domain (rust-engine plan T1.1); that crate re-exports
// these so each wire shape has ONE canonical Rust definition.
