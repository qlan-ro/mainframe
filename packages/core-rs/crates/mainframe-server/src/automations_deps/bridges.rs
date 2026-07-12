//! Notifier / EventSink / EventSource bridges between the engine's ports and
//! the daemon bus (broadcast) + PushService.

use std::sync::Arc;

use mainframe_automations::engine::BoxFuture;
use mainframe_automations::ports::{
    AutomationEvent, CuratedEvent, EventSink, EventSource, Notification, Notifier, NotifyError,
};
use mainframe_services::push::{PushMessage, PushPriority, PushService};
use mainframe_types::events::{ChatUpdatedReason, DaemonEvent};
use tokio::sync::broadcast;

/// WS `automation.notification` + mobile push (Node verbs/notify.ts:
/// `data: {runId}`, priority default). Best-effort by contract.
pub struct DaemonNotifier {
    broadcast: broadcast::Sender<DaemonEvent>,
    push: Arc<PushService>,
}

impl DaemonNotifier {
    pub fn new(broadcast: broadcast::Sender<DaemonEvent>, push: Arc<PushService>) -> Self {
        Self { broadcast, push }
    }
}

impl Notifier for DaemonNotifier {
    fn notify(&self, notification: Notification) -> BoxFuture<'_, Result<(), NotifyError>> {
        Box::pin(async move {
            let message = PushMessage {
                title: notification.title.clone(),
                body: notification.body.clone(),
                data: serde_json::json!({ "runId": notification.run_id }),
                priority: PushPriority::Default,
            };
            let _ = self.broadcast.send(DaemonEvent::AutomationNotification {
                run_id: notification.run_id,
                automation_id: notification.automation_id,
                title: notification.title,
                body: notification.body,
                links: notification.links,
            });
            self.push.send_push(message).await;
            Ok(())
        })
    }
}

/// Engine event → daemon bus. The payload types are shared (T9.1), so the
/// mapping is a plain move — no re-serialization to drift.
pub struct DaemonEventSink {
    broadcast: broadcast::Sender<DaemonEvent>,
}

impl DaemonEventSink {
    pub fn new(broadcast: broadcast::Sender<DaemonEvent>) -> Self {
        Self { broadcast }
    }
}

impl EventSink for DaemonEventSink {
    fn emit(&self, event: AutomationEvent) {
        let _ = self.broadcast.send(map_automation_event(event));
    }
}

pub fn map_automation_event(event: AutomationEvent) -> DaemonEvent {
    match event {
        AutomationEvent::RunUpdated { run } => DaemonEvent::AutomationRunUpdated { run },
        AutomationEvent::InteractionCreated { interaction } => {
            DaemonEvent::AutomationInteractionCreated { interaction }
        }
        AutomationEvent::InteractionResolved {
            interaction_id,
            run_id,
        } => DaemonEvent::AutomationInteractionResolved {
            interaction_id,
            run_id,
        },
        AutomationEvent::Completed {
            automation_id,
            automation_name,
            run_id,
            status,
            result,
        } => DaemonEvent::AutomationCompleted {
            automation_id,
            automation_name,
            run_id,
            status,
            result,
        },
    }
}

/// Daemon bus → `CuratedEvent` stream for the trigger router: terminal
/// `chat.updated` frames become `session.finished` (contract §1 — app events
/// only; chaining rides the CompletionEmitter, not this bridge).
pub struct DaemonEventSource {
    tx: broadcast::Sender<CuratedEvent>,
}

impl DaemonEventSource {
    pub fn spawn(mut daemon_rx: broadcast::Receiver<DaemonEvent>) -> Arc<Self> {
        let (tx, _keep) = broadcast::channel(256);
        let source = Arc::new(Self { tx });
        let pump_tx = source.tx.clone();
        tokio::spawn(async move {
            loop {
                match daemon_rx.recv().await {
                    Ok(DaemonEvent::ChatUpdated {
                        chat,
                        reason: Some(reason),
                    }) => {
                        let _ = pump_tx.send(CuratedEvent::SessionFinished {
                            chat_id: chat.id,
                            reason: reason_str(reason).to_string(),
                        });
                    }
                    Ok(_) => {}
                    Err(broadcast::error::RecvError::Lagged(missed)) => {
                        tracing::warn!(missed, "automation event source lagged");
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        source
    }
}

impl EventSource for DaemonEventSource {
    fn subscribe(&self) -> broadcast::Receiver<CuratedEvent> {
        self.tx.subscribe()
    }
}

fn reason_str(reason: ChatUpdatedReason) -> &'static str {
    match reason {
        ChatUpdatedReason::Completed => "completed",
        ChatUpdatedReason::Error => "error",
        ChatUpdatedReason::Interrupted => "interrupted",
    }
}

// PORT STATUS: packages/core/src/automations/service.ts onDaemonEvent +
// verbs/notify.ts push path
// confidence: high
// todos: 0
// notes: the source keeps its own channel so subscribers created later
//        (start(), T10.1) miss nothing that matters — bindings are derived
//        per event, no arming state.
