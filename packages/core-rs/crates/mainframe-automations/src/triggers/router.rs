//! Event-trigger router + chaining (T8.3, Node triggers/events.ts +
//! service.ts onDaemonEvent/emitCompletionEvent). Bindings are derived from
//! the enabled automations on every event — no armed in-memory state to
//! drift (same philosophy as the schedule sweep). Chaining short-circuits:
//! the CompletionEmitter emits the `automation.completed` WS event AND
//! routes it as a `CuratedEvent` directly, so the `EventSource` port stays
//! app-events-only (`session.finished`).

use std::sync::Arc;

use serde_json::{Value, json};
use tokio::sync::broadcast::error::RecvError;

use crate::domain::{AutomationEventName, Trigger};
use crate::ports::{CompletedStatus, CuratedEvent, EventSource};
use crate::store::{AutomationRecord, AutomationStore, RunTriggerContext, RunTriggerKind};

use super::fire::TriggerFirer;

/// Excludes chats owned by an in-flight ask_agent wait from
/// `session.finished`: that chat's completion already drives its own step —
/// treating it as a fresh event too would double-fire (Node
/// isAgentOwnedChat). `AgentVerb` implements this over its wait map.
pub trait AgentOwnedChats: Send + Sync {
    fn is_agent_owned(&self, chat_id: &str) -> bool;
}

impl AgentOwnedChats for crate::engine::AgentVerb {
    fn is_agent_owned(&self, chat_id: &str) -> bool {
        self.wait_key(chat_id).is_some()
    }
}

/// One armed event trigger (Node EventTriggerBinding).
pub struct EventTriggerBinding {
    pub automation_id: String,
    pub trigger_id: String,
    pub event: AutomationEventName,
    /// For the chaining selectors: only fire when the source automation
    /// matches (unset = any).
    pub automation_filter: Option<String>,
}

pub struct EventTriggerMatch {
    pub automation_id: String,
    pub trigger_id: String,
    /// Flat token bag frozen as the run's `trigger.payload`.
    pub tokens: Value,
    /// The second half of the dedup key (`<triggerId>|<source>`): the chat
    /// id or the source run id — a re-emitted event never double-fires.
    pub dedup_source: String,
}

pub fn event_bindings(automations: &[AutomationRecord]) -> Vec<EventTriggerBinding> {
    let mut bindings = Vec::new();
    for automation in automations {
        for trigger in &automation.definition.triggers {
            if let Trigger::Event(event) = trigger {
                bindings.push(EventTriggerBinding {
                    automation_id: automation.id.clone(),
                    trigger_id: event.id.clone(),
                    event: event.event,
                    automation_filter: event.automation_id.clone(),
                });
            }
        }
    }
    bindings
}

/// Matches bindings against one event (Node matchEventTriggers). The
/// `automation.finished`/`automation.failed` selectors both filter the ONE
/// `automation.completed` event by status.
pub fn match_event_triggers(
    bindings: &[EventTriggerBinding],
    event: &CuratedEvent,
    is_agent_owned: &dyn Fn(&str) -> bool,
) -> Vec<EventTriggerMatch> {
    let (wanted, tokens, dedup_source) = match event {
        CuratedEvent::SessionFinished { chat_id, reason } => {
            if is_agent_owned(chat_id) {
                return Vec::new();
            }
            (
                AutomationEventName::SessionFinished,
                json!({"result": reason, "chatId": chat_id}),
                chat_id.clone(),
            )
        }
        CuratedEvent::AutomationCompleted {
            run_id,
            status,
            result,
            ..
        } => {
            let wanted = match status {
                CompletedStatus::Succeeded => AutomationEventName::AutomationFinished,
                CompletedStatus::Failed => AutomationEventName::AutomationFailed,
            };
            (wanted, json!({"result": result}), run_id.clone())
        }
    };

    let source_automation = match event {
        CuratedEvent::AutomationCompleted { automation_id, .. } => Some(automation_id.as_str()),
        CuratedEvent::SessionFinished { .. } => None,
    };
    bindings
        .iter()
        .filter(|binding| binding.event == wanted)
        .filter(
            |binding| match (&binding.automation_filter, source_automation) {
                (Some(filter), Some(source)) => filter == source,
                (Some(_), None) => false,
                (None, _) => true,
            },
        )
        .map(|binding| EventTriggerMatch {
            automation_id: binding.automation_id.clone(),
            trigger_id: binding.trigger_id.clone(),
            tokens: tokens.clone(),
            dedup_source: dedup_source.clone(),
        })
        .collect()
}

pub struct TriggerRouter {
    automations: AutomationStore,
    firer: Arc<TriggerFirer>,
    agent_owned: Option<Arc<dyn AgentOwnedChats>>,
}

impl TriggerRouter {
    pub fn new(
        automations: AutomationStore,
        firer: Arc<TriggerFirer>,
        agent_owned: Option<Arc<dyn AgentOwnedChats>>,
    ) -> Self {
        Self {
            automations,
            firer,
            agent_owned,
        }
    }

    pub async fn handle_event(&self, event: &CuratedEvent) {
        let enabled = match self.automations.list_enabled().await {
            Ok(enabled) => enabled,
            Err(err) => {
                tracing::error!(error = %err, "event router: listing automations failed");
                return;
            }
        };
        let bindings = event_bindings(&enabled);
        let agent_owned = self.agent_owned.clone();
        let is_owned = move |chat_id: &str| {
            agent_owned
                .as_ref()
                .is_some_and(|chats| chats.is_agent_owned(chat_id))
        };
        for matched in match_event_triggers(&bindings, event, &is_owned) {
            let context = RunTriggerContext {
                kind: RunTriggerKind::Event,
                trigger_id: Some(matched.trigger_id.clone()),
                scheduled_for: None,
                payload: Some(matched.tokens),
            };
            let dedup_key = format!("{}|{}", matched.trigger_id, matched.dedup_source);
            if let Err(err) = self
                .firer
                .fire_run(&matched.automation_id, context, Some(dedup_key))
                .await
            {
                tracing::error!(
                    automation_id = matched.automation_id,
                    error = %err,
                    "event router: fire failed"
                );
            }
        }
    }
}

/// Subscribes an EventSource and dispatches until the sender closes
/// (armed by the facade, T10.1).
pub fn spawn_event_loop(
    router: Arc<TriggerRouter>,
    source: Arc<dyn EventSource>,
) -> tokio::task::JoinHandle<()> {
    let mut rx = source.subscribe();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => router.handle_event(&event).await,
                Err(RecvError::Lagged(missed)) => {
                    tracing::warn!(missed, "event router lagged; some events dropped");
                }
                Err(RecvError::Closed) => break,
            }
        }
    })
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T8.3), not a TS port
// confidence: high
// todos: 0
// notes: bindings derived per event instead of Node's armed array; the
//        chaining hook lives in completion.rs (300-line file cap).
