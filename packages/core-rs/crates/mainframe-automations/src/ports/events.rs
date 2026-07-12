//! Event port: every engine transition the UI must see leaves through this
//! sink. The payload shapes are the contract §4 WS bodies; mainframe-server
//! (T9.x) maps `AutomationEvent` onto `DaemonEvent` variants 1:1.

use serde::Serialize;
use serde_json::Value;

use crate::store::{RunRecord, RunStatus, RunTriggerKind};

/// Engine-side event union (grows with later phases: interaction created/
/// resolved, notification, completed). Serde names are the §4 wire truth so
/// the DaemonEvent mapping cannot drift silently.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type")]
pub enum AutomationEvent {
    /// A6 — emitted on run start, EVERY leaf-step terminal transition, park,
    /// and finalize, so consecutive deterministic steps stream to the run view.
    #[serde(rename = "automation.run.updated")]
    RunUpdated { run: RunSummary },
}

pub trait EventSink: Send + Sync {
    fn emit(&self, event: AutomationEvent);
}

/// Wire projection of a run (Node `toRunSummary`, types `AutomationRunSummary`):
/// `finishedAt`/`error` are `T | null` there, so no omit-when-absent.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub id: String,
    pub automation_id: String,
    pub status: RunStatus,
    pub trigger: RunTriggerSummary,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTriggerSummary {
    pub kind: RunTriggerKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens: Option<Value>,
}

pub fn to_run_summary(run: &RunRecord) -> RunSummary {
    RunSummary {
        id: run.id.clone(),
        automation_id: run.automation_id.clone(),
        status: run.status,
        trigger: RunTriggerSummary {
            kind: run.checkpoint.trigger.kind,
            tokens: None,
        },
        started_at: run.started_at,
        finished_at: run.finished_at,
        error: run.checkpoint.error.clone(),
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T4.1, A6), not a TS port
// confidence: high
// todos: 0
// notes: mirrors Node engine/run-summary.ts (trigger projects {kind} only;
//        `tokens` reserved by the AutomationRunSummary type).
