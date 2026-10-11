use mainframe_background_tasks::tracker::{BackgroundTaskTracker, TaskEvent};
use mainframe_types::events::DaemonEvent;
use std::sync::Arc;
use tokio::sync::broadcast;
pub(crate) fn spawn_task_event_bridge(
    tracker: Arc<BackgroundTaskTracker>,
    bus: broadcast::Sender<DaemonEvent>,
) {
    let mut rx = tracker.subscribe();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(TaskEvent::Started { chat_id, task }) => {
                    let _ = bus.send(DaemonEvent::BackgroundTaskStarted { chat_id, task });
                }
                Ok(TaskEvent::Updated { chat_id, task }) => {
                    let _ = bus.send(DaemonEvent::BackgroundTaskUpdated { chat_id, task });
                }
                Ok(TaskEvent::Ended { chat_id, task }) => {
                    let _ = bus.send(DaemonEvent::BackgroundTaskEnded { chat_id, task });
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!(dropped = n, "task-event bridge lagged");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}
