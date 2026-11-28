//! Event-driven blocking waits. A waiter subscribes to the daemon broadcast
//! *before* its first state read, then re-reads only on an event for a chat it
//! watches (or after the receiver lagged). There is no periodic poll.
//!
//! Every wait registers the chats it watches for as long as it runs
//! ([`is_watched`]): the idle history release keeps a watched chat's history,
//! which the waiting agent is about to read.

use std::collections::HashMap;
use std::future::Future;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use mainframe_types::events::DaemonEvent;
use tokio::sync::broadcast::Receiver;
use tokio::sync::broadcast::error::RecvError;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use crate::calls::CallCtx;
use crate::service::OrchestrationService;

/// How many running waits watch each chat.
static WATCHED: LazyLock<Mutex<HashMap<String, usize>>> = LazyLock::new(Mutex::default);

/// Whether a running wait (`chat_wait`, a task wait, the external MCP wait)
/// watches the chat.
pub fn is_watched(chat_id: &str) -> bool {
    watched().contains_key(chat_id)
}

fn watched() -> std::sync::MutexGuard<'static, HashMap<String, usize>> {
    WATCHED
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// One wait's registration, removed when the wait ends however it ends.
struct Watching(Vec<String>);

impl Watching {
    fn new(chat_ids: &[String]) -> Self {
        let mut watched = watched();
        for id in chat_ids {
            *watched.entry(id.clone()).or_default() += 1;
        }
        Self(chat_ids.to_vec())
    }
}

impl Drop for Watching {
    fn drop(&mut self) {
        let mut watched = watched();
        for id in &self.0 {
            if let Some(count) = watched.get_mut(id) {
                *count -= 1;
                if *count == 0 {
                    watched.remove(id);
                }
            }
        }
    }
}

pub enum WaitEnd<T> {
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

/// Runs `probe` until it yields, re-running it on each relevant event, and
/// stops when nobody is left to read the reply.
pub(crate) async fn wait_for<T, F, Fut>(
    svc: &OrchestrationService,
    ctx: &CallCtx,
    timeout: Duration,
    watched: &[String],
    probe: F,
) -> WaitEnd<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Option<T>>,
{
    wait_until(
        svc.port.subscribe(),
        timeout,
        watched,
        &ctx.abandoned,
        probe,
    )
    .await
}

/// [`wait_for`] for callers with no calling turn to cancel it. `rx` must be
/// subscribed before the call so no transition ahead of the first `probe` is
/// lost. `Cancelled` here means the event stream closed.
pub async fn wait_on<T, F, Fut>(
    rx: Receiver<DaemonEvent>,
    timeout: Duration,
    watched: &[String],
    probe: F,
) -> WaitEnd<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Option<T>>,
{
    wait_until(rx, timeout, watched, &CancellationToken::new(), probe).await
}

/// Cancellation is checked only between probes. A probe may finalize a task
/// and hand its result to the parent, so dropping one halfway would lose it.
async fn wait_until<T, F, Fut>(
    mut rx: Receiver<DaemonEvent>,
    timeout: Duration,
    watched: &[String],
    cancel: &CancellationToken,
    mut probe: F,
) -> WaitEnd<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Option<T>>,
{
    let _watching = Watching::new(watched);
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(found) = probe().await {
            return WaitEnd::Matched(found);
        }
        loop {
            tokio::select! {
                () = cancel.cancelled() => return WaitEnd::Cancelled,
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

#[cfg(test)]
#[path = "waiter_tests.rs"]
mod tests;
