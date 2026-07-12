//! The chaining hook (T8.3, Node service.ts emitCompletionEvent +
//! service-helpers.ts summarizeRunResult): a `succeeded|failed` finalize
//! emits `automation.completed` and feeds the router directly, so the
//! EventSource port stays app-events-only.

use std::sync::{Arc, OnceLock};

use crate::engine::{BoxFuture, RunFinalizedHook};
use crate::ports::{AutomationEvent, CompletedStatus, CuratedEvent, EventSink};
use crate::store::{AutomationStore, RunRecord, RunStatus};
use crate::tokens::TokenValue;

use super::router::TriggerRouter;

/// Late-bound router (AgentVerb::bind_advancer precedent) — the interpreter
/// that owns this hook is itself a dependency of the router's firer.
pub struct CompletionEmitter {
    automations: AutomationStore,
    events: Arc<dyn EventSink>,
    router: OnceLock<Arc<TriggerRouter>>,
}

impl CompletionEmitter {
    pub fn new(automations: AutomationStore, events: Arc<dyn EventSink>) -> Arc<Self> {
        Arc::new(Self {
            automations,
            events,
            router: OnceLock::new(),
        })
    }

    pub fn bind_router(&self, router: Arc<TriggerRouter>) {
        if self.router.set(router).is_err() {
            tracing::warn!("completion emitter router already bound; ignoring rebind");
        }
    }
}

impl RunFinalizedHook for CompletionEmitter {
    fn on_finalized<'a>(&'a self, run: &'a RunRecord) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            let status = match run.status {
                RunStatus::Succeeded => CompletedStatus::Succeeded,
                RunStatus::Failed => CompletedStatus::Failed,
                // Cancelled never completes (Node parity).
                _ => return,
            };
            let automation_name = match self.automations.get(&run.automation_id).await {
                Ok(Some(automation)) => automation.name,
                Ok(None) => run.automation_id.clone(),
                Err(err) => {
                    tracing::warn!(error = %err, "completion emitter: name lookup failed");
                    run.automation_id.clone()
                }
            };
            let result = summarize_run_result(run);
            self.events.emit(AutomationEvent::Completed {
                automation_id: run.automation_id.clone(),
                automation_name,
                run_id: run.id.clone(),
                status,
                result: result.clone(),
            });
            if let Some(router) = self.router.get() {
                router
                    .handle_event(&CuratedEvent::AutomationCompleted {
                        automation_id: run.automation_id.clone(),
                        run_id: run.id.clone(),
                        status,
                        result,
                    })
                    .await;
            }
        })
    }
}

/// The ⟨its result⟩ token a chained trigger reads (Node summarizeRunResult):
/// the run error on failure; else the last-finished step's outputs, coerced
/// with the Decision-9 stringification chips use. Node takes the last
/// checkpoint entry in insertion order; the BTreeMap equivalent is the
/// entry with the greatest finish/start stamp.
///
/// ACCEPTED DIVERGENCE: on a same-millisecond (finished_at, started_at) tie
/// this picks the lexically-greatest stepRef, whereas Node picks the JS-object
/// insertion (execution) order. The contract §2 checkpoint carries no
/// execution-sequence field, and adding one would diverge Rust's checkpoint
/// from both the contract and the Node engine — so true parity needs an
/// insertion-ordered `steps` map on BOTH arms, tracked as a cross-engine
/// follow-up. The tie only reaches the chained-automation ⟨its result⟩ when the
/// terminal step shares a millisecond with a sibling; sequential runs are
/// monotonic and unaffected.
pub fn summarize_run_result(run: &RunRecord) -> String {
    if run.status == RunStatus::Failed {
        return run
            .checkpoint
            .error
            .clone()
            .unwrap_or_else(|| "automation failed".to_string());
    }
    let last = run
        .checkpoint
        .steps
        .values()
        .max_by_key(|e| (e.finished_at, e.started_at));
    let Some(outputs) = last.and_then(|entry| entry.outputs.as_ref()) else {
        return String::new();
    };
    let mut values = outputs.values();
    match (values.next(), values.next()) {
        (None, _) => String::new(),
        (Some(single), None) => TokenValue::from_json(single)
            .map(|value| value.coerce_to_string())
            .unwrap_or_default(),
        _ => serde_json::to_string(outputs).unwrap_or_default(),
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T8.3), not a TS port
// confidence: high
// todos: 0
// notes: split from router.rs for the 300-line file cap.
