//! Installs a synchronous sink on the `BackgroundTaskTracker` so
//! `background_task.started`/`.updated`/`.ended` reach the daemon bus inline,
//! before the tracker call that produced them returns — replacing
//! `spawn_task_event_bridge`'s spawned forwarding task, which could not run
//! until the current task yielded. That gap let a synchronous `chat.updated`
//! emitted right after a tracker sweep (see `on_exit`) reach clients before
//! the `ended` events the sweep produced, so a client's snapshot omitted
//! tasks whose `ended` hadn't arrived yet.

use std::sync::Arc;

use mainframe_background_tasks::tracker::{BackgroundTaskTracker, TaskEvent};
use mainframe_types::events::DaemonEvent;
use tokio::sync::broadcast;

/// Wires `tracker`'s events onto `bus` synchronously. Call once, before any
/// adapter session can start (so no event is ever missed).
pub fn install_task_event_sink(
    tracker: &BackgroundTaskTracker,
    bus: broadcast::Sender<DaemonEvent>,
) {
    tracker.set_event_sink(Arc::new(move |event: &TaskEvent| {
        let daemon_event = match event.clone() {
            TaskEvent::Started { chat_id, task } => {
                DaemonEvent::BackgroundTaskStarted { chat_id, task }
            }
            TaskEvent::Updated { chat_id, task } => {
                DaemonEvent::BackgroundTaskUpdated { chat_id, task }
            }
            TaskEvent::Ended { chat_id, task } => {
                DaemonEvent::BackgroundTaskEnded { chat_id, task }
            }
        };
        // send() errors only when there are no subscribers — not fatal, and
        // nothing was buffered, so there is no lag warning to give anymore.
        let _ = bus.send(daemon_event);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_background_tasks::tracker::{TaskSeed, TerminalUpdate};
    use mainframe_types::background_task::{
        BackgroundTaskStatus, BackgroundTaskToolName, BackgroundWorkKind,
    };

    fn seed(id: &str) -> TaskSeed {
        TaskSeed {
            id: id.to_string(),
            kind: BackgroundWorkKind::Bash,
            tool_name: BackgroundTaskToolName::Bash,
            tool_use_id: "u".to_string(),
            command: "x".to_string(),
            description: String::new(),
            workflow_name: None,
            reported_type: None,
        }
    }

    /// Pins the bus order the whole fix exists for: a tracker sweep
    /// (`end_all_running`) followed immediately by a synchronous bus send —
    /// exactly what `on_exit` does with its `ChatUpdated` (stood in for here
    /// by the equally synchronous `ChatEnded`, to avoid constructing a full
    /// `Chat`) — must deliver every `BackgroundTaskEnded` first, with no
    /// intervening task yield required.
    #[test]
    fn bus_receives_every_ended_event_before_a_synchronous_send_that_follows() {
        let tracker = BackgroundTaskTracker::new();
        let (bus, mut rx) = broadcast::channel::<DaemonEvent>(16);
        install_task_event_sink(&tracker, bus.clone());

        tracker.start("chat-a", seed("t1"), "/p/t1".to_string());
        tracker.start("chat-a", seed("t2"), "/p/t2".to_string());
        // Drain the two `started` events so only the sweep's output is left.
        while rx.try_recv().is_ok() {}

        tracker.end_all_running("chat-a");
        let _ = bus.send(DaemonEvent::ChatEnded {
            chat_id: "chat-a".to_string(),
        });

        let mut order = Vec::new();
        while let Ok(ev) = rx.try_recv() {
            order.push(match ev {
                DaemonEvent::BackgroundTaskEnded { task, .. } => format!("ended:{}", task.id),
                DaemonEvent::ChatEnded { .. } => "chat_ended".to_string(),
                other => panic!("unexpected event: {other:?}"),
            });
        }
        assert_eq!(order.len(), 3, "expected 2 ended + 1 chat_ended: {order:?}");
        assert_eq!(order.last().unwrap(), "chat_ended");
        let mut ended: Vec<&String> = order[..2].iter().collect();
        ended.sort();
        assert_eq!(ended, vec!["ended:t1", "ended:t2"]);
    }

    #[test]
    fn a_second_task_started_after_install_maps_to_started_on_the_bus() {
        let tracker = BackgroundTaskTracker::new();
        let (bus, mut rx) = broadcast::channel::<DaemonEvent>(16);
        install_task_event_sink(&tracker, bus);

        tracker.start("chat-a", seed("t1"), "/p/t1".to_string());
        match rx.try_recv().unwrap() {
            DaemonEvent::BackgroundTaskStarted { chat_id, task } => {
                assert_eq!(chat_id, "chat-a");
                assert_eq!(task.id, "t1");
            }
            other => panic!("expected BackgroundTaskStarted, got {other:?}"),
        }
    }

    #[test]
    fn an_updated_task_maps_to_updated_on_the_bus() {
        let tracker = BackgroundTaskTracker::new();
        let (bus, mut rx) = broadcast::channel::<DaemonEvent>(16);
        install_task_event_sink(&tracker, bus);

        tracker.start("chat-a", seed("t1"), "/p/t1".to_string());
        rx.try_recv().unwrap(); // drain started
        tracker.link_run_id("chat-a", "t1", "run-1", None);
        match rx.try_recv().unwrap() {
            DaemonEvent::BackgroundTaskUpdated { chat_id, task } => {
                assert_eq!(chat_id, "chat-a");
                assert_eq!(task.run_id.as_deref(), Some("run-1"));
            }
            other => panic!("expected BackgroundTaskUpdated, got {other:?}"),
        }
    }

    #[test]
    fn end_maps_to_ended_on_the_bus() {
        let tracker = BackgroundTaskTracker::new();
        let (bus, mut rx) = broadcast::channel::<DaemonEvent>(16);
        install_task_event_sink(&tracker, bus);

        tracker.start("chat-a", seed("t1"), "/p/t1".to_string());
        rx.try_recv().unwrap(); // drain started
        tracker.end(
            "chat-a",
            "t1",
            TerminalUpdate {
                status: BackgroundTaskStatus::Completed,
                output_path: String::new(),
                summary: "done".to_string(),
                usage: None,
            },
        );
        match rx.try_recv().unwrap() {
            DaemonEvent::BackgroundTaskEnded { chat_id, task } => {
                assert_eq!(chat_id, "chat-a");
                assert_eq!(task.status, BackgroundTaskStatus::Completed);
            }
            other => panic!("expected BackgroundTaskEnded, got {other:?}"),
        }
    }
}
