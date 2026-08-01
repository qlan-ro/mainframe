//! Drains the store's `RunEvent` broadcast and re-emits as daemon
//! `claude_workflow.run.updated` events. Mirrors `main.rs`'s
//! `spawn_task_event_bridge` exactly (A3 — a second such bridge belongs in
//! this crate, not in the already over-limit `main.rs`).

use std::sync::Arc;

use mainframe_types::events::DaemonEvent;
use tokio::sync::broadcast;

use crate::store::ClaudeWorkflowStore;

pub fn spawn_workflow_run_bridge(
    store: Arc<ClaudeWorkflowStore>,
    bus: broadcast::Sender<DaemonEvent>,
) {
    let mut rx = store.subscribe();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let _ = bus.send(DaemonEvent::ClaudeWorkflowRunUpdated {
                        chat_id: event.chat_id,
                        run: event.run,
                    });
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!(dropped = n, "claude-workflow event bridge lagged");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}
