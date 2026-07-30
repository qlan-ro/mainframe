//! Drains the store's `RunEvent` broadcast and re-emits as daemon
//! `claude_workflow.run.updated` events. Mirrors `main.rs`'s
//! `spawn_task_event_bridge` exactly (A3 — a second such bridge belongs in
//! this crate, not in the already over-limit `main.rs`).

use std::sync::Arc;

use mainframe_types::events::DaemonEvent;
use tokio::sync::broadcast;

use crate::store::ClaudeWorkflowStore;

pub fn spawn_workflow_run_bridge(
    _store: Arc<ClaudeWorkflowStore>,
    _bus: broadcast::Sender<DaemonEvent>,
) {
    unimplemented!("wf-core")
}
