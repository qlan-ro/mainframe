//! Event port: every engine transition the UI must see leaves through this
//! sink. The payload shapes are the contract §4 WS bodies; mainframe-server
//! (T9.x) maps `AutomationEvent` onto `DaemonEvent` variants 1:1.

use serde::Serialize;

use crate::store::{InteractionRecord, RunRecord};

// Canonical wire payloads live in `mainframe-types` (the DaemonEvent
// variants carry them, T9.1); the engine keeps its original local names.
pub use mainframe_types::automation::{
    AutomationCompletedStatus as CompletedStatus,
    AutomationInteractionSummary as InteractionSummary, AutomationRunSummary as RunSummary,
    AutomationRunTrigger as RunTriggerSummary,
};

/// Engine-side event union (notification rides the Notifier port). Serde
/// names are the §4 wire truth so the DaemonEvent mapping cannot drift
/// silently.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type")]
pub enum AutomationEvent {
    /// A6 — emitted on run start, EVERY leaf-step terminal transition, park,
    /// and finalize, so consecutive deterministic steps stream to the run view.
    #[serde(rename = "automation.run.updated")]
    RunUpdated { run: RunSummary },
    #[serde(rename = "automation.interaction.created")]
    InteractionCreated { interaction: InteractionSummary },
    #[serde(rename = "automation.interaction.resolved", rename_all = "camelCase")]
    InteractionResolved {
        interaction_id: String,
        run_id: String,
    },
    /// One WS event serves both chaining selectors (contract §4): the
    /// `automation.finished`/`automation.failed` triggers filter this by
    /// `status` — they are NOT separate events.
    #[serde(rename = "automation.completed", rename_all = "camelCase")]
    Completed {
        automation_id: String,
        automation_name: String,
        run_id: String,
        status: CompletedStatus,
        result: String,
    },
}

pub trait EventSink: Send + Sync {
    fn emit(&self, event: AutomationEvent);
}

/// App events the trigger router consumes (T8.3). Carries app events only —
/// GitHub PR opened/merged are webhook presets, not events (contract §1) —
/// and `automation.completed` for chaining, which the CompletionEmitter
/// feeds without a round-trip through the daemon bus.
#[derive(Debug, Clone, PartialEq)]
pub enum CuratedEvent {
    /// The CLI process behind a chat reached a terminal reason (the T9.2
    /// port impl maps terminal `chat.updated` frames onto this).
    SessionFinished { chat_id: String, reason: String },
    AutomationCompleted {
        automation_id: String,
        run_id: String,
        status: CompletedStatus,
        result: String,
    },
}

/// Subscription port (T8.3): the daemon side owns the broadcast sender and
/// maps its own event stream into `CuratedEvent`s — no polling.
pub trait EventSource: Send + Sync {
    fn subscribe(&self) -> tokio::sync::broadcast::Receiver<CuratedEvent>;
}

pub fn to_interaction_summary(record: &InteractionRecord) -> InteractionSummary {
    InteractionSummary {
        id: record.id.clone(),
        run_id: record.run_id.clone(),
        step_ref: record.step_ref.clone(),
        title: record.title.clone(),
        fields: record.fields.clone(),
        status: record.status,
        created_at: record.created_at,
        resolved_at: record.resolved_at,
    }
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
