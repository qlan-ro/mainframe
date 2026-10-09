//! Event-driven blocking waits. A waiter subscribes to the daemon broadcast
//! *before* its first state read, then re-reads only on an event for a chat it
//! watches (or after the receiver lagged). There is no periodic poll.

use std::future::Future;
use std::time::Duration;

use mainframe_types::events::DaemonEvent;
use tokio::sync::broadcast::error::RecvError;
use tokio::time::Instant;

use crate::service::{CallCtx, OrchestrationService};

pub(crate) enum WaitEnd<T> {
    Matched(T),
    TimedOut,
    Cancelled,
}

/// The chat an event concerns. `None` for events that carry no chat id.
pub(crate) fn event_chat_id(event: &DaemonEvent) -> Option<&str> {
    match event {
        DaemonEvent::ChatUpdated { chat, .. } | DaemonEvent::ChatCreated { chat, .. } => {
            Some(chat.id.as_str())
        }
        DaemonEvent::ChatEnded { chat_id } | DaemonEvent::ChatOffloaded { chat_id } => {
            Some(chat_id.as_str())
        }
        _ => None,
    }
}

fn is_relevant(event: &DaemonEvent, watched: &[String]) -> bool {
    match event {
        // A process exit carries only the provider session id.
        DaemonEvent::ProcessStopped { .. } => true,
        DaemonEvent::DelegatedTaskUpdated { task } => watched
            .iter()
            .any(|w| *w == task.child_chat_id || *w == task.parent_chat_id),
        _ => event_chat_id(event).is_some_and(|id| watched.iter().any(|w| w == id)),
    }
}

/// Runs `probe` until it yields, re-running it on each relevant event.
pub(crate) async fn wait_for<T, F, Fut>(
    svc: &OrchestrationService,
    ctx: &CallCtx,
    timeout: Duration,
    watched: &[String],
    mut probe: F,
) -> WaitEnd<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Option<T>>,
{
    let mut rx = svc.port.subscribe();
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(found) = probe().await {
            return WaitEnd::Matched(found);
        }
        loop {
            tokio::select! {
                () = ctx.cancel.cancelled() => return WaitEnd::Cancelled,
                () = tokio::time::sleep_until(deadline) => return WaitEnd::TimedOut,
                received = rx.recv() => match received {
                    Ok(event) if is_relevant(&event, watched) => break,
                    Ok(_) => {}
                    Err(RecvError::Lagged(_)) => break,
                    Err(RecvError::Closed) => return WaitEnd::Cancelled,
                },
            }
        }
    }
}
