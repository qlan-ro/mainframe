//! Re-emits the store's `RunEvent`s on the daemon event bus as
//! `claude_workflow.run.updated`.

use mainframe_types::events::DaemonEvent;
use tokio::sync::broadcast;

use crate::store::ClaudeWorkflowStore;

/// Spawns the forwarding task. It ends when the store is dropped.
pub fn spawn_workflow_run_bridge(store: &ClaudeWorkflowStore, bus: broadcast::Sender<DaemonEvent>) {
    let mut rx = store.subscribe();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    // No subscribers is the normal state between WS clients.
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
