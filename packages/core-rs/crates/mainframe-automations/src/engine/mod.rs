//! Interpreter (plan Phase 4): replay-based `advance()` over the frozen
//! `checkpoint.definition` — skip committed steps, execute the first live
//! one, commit, repeat. Verbs are injected via `VerbPorts` so the walk stays
//! testable with fakes; real verb impls land in Phases 5-7.

pub mod advance;
pub mod agent;
mod agent_settle;
pub(crate) mod blocks;
pub(crate) mod checkpoint;
mod deadline;
pub(crate) mod expects;
pub mod notify_verb;
pub mod run_action_verb;
mod run_locks;
pub(crate) mod walk;

pub use advance::{AgentWaitRegistry, Interpreter, InterpreterDeps};
pub use agent::AgentVerb;
pub use notify_verb::NotifyVerb;
pub use run_action_verb::RunActionVerb;

use std::future::Future;
use std::pin::Pin;

use serde_json::{Map, Value};

use crate::domain::{AskAgentStep, AskMeStep, NotifyStep, RunActionStep};
use crate::error::StoreError;
use crate::tokens::Scope;

/// Local dyn-future alias (the repo's `mainframe-adapter-api::BoxFuture`
/// pattern — this crate must not depend on adapter-api).
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// One verb execution's result (Node engine/types.ts `StepOutcome`).
#[derive(Debug, Clone, PartialEq)]
pub enum StepOutcome {
    Completed { outputs: Map<String, Value> },
    Wait { wake_at: Option<i64> },
    Failed { error: String },
}

/// Result of walking one step sequence to the end, a park point, or a hard
/// failure (Node `WalkResult`).
#[derive(Debug, Clone, PartialEq)]
pub enum WalkResult {
    Done,
    Parked,
    Failed { error: String },
}

/// What a verb sees: run/step identity plus the frame's token scope.
/// Cancellation is structural — the interpreter drops the walk future on
/// `cancel_run`, so no cooperative signal is threaded through (unlike Node's
/// AbortSignal, which promises cannot drop).
pub struct VerbContext<'a> {
    pub run_id: &'a str,
    pub step_ref: &'a str,
    pub scope: &'a Scope<'a>,
}

/// Post-finalize hook (T8.3): the CompletionEmitter turns a finalized
/// `succeeded|failed` run into the `automation.completed` event + chained
/// trigger fires. Runs after the terminal store write, outside it — a hook
/// failure can never un-finalize a run.
pub trait RunFinalizedHook: Send + Sync {
    fn on_finalized<'a>(&'a self, run: &'a crate::store::RunRecord) -> BoxFuture<'a, ()>;
}

/// Late-bound advance handle (T4.3): the settle/respond paths re-enter the
/// interpreter after an external completion, but the interpreter owns the
/// VerbPorts that contain those verbs — a trait breaks the construction
/// cycle. `fail_run` finalizes `failed` + emits (the no-keepGoing policy).
pub trait RunAdvancer: Send + Sync {
    fn advance_run<'a>(&'a self, run_id: &'a str) -> BoxFuture<'a, Result<(), StoreError>>;
    fn fail_run<'a>(
        &'a self,
        run_id: &'a str,
        error: &'a str,
    ) -> BoxFuture<'a, Result<(), StoreError>>;
}

/// The four Do-verbs, injected (Node engine/types.ts `VerbPorts`). Dyn-safe
/// via `BoxFuture` (native async-fn-in-trait is not object safe).
pub trait VerbPorts: Send + Sync {
    fn ask_agent<'a>(
        &'a self,
        step: &'a AskAgentStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome>;
    fn ask_me<'a>(
        &'a self,
        step: &'a AskMeStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome>;
    fn run_action<'a>(
        &'a self,
        step: &'a RunActionStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome>;
    fn notify<'a>(
        &'a self,
        step: &'a NotifyStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome>;
}

#[cfg(test)]
pub(crate) mod test_support;

#[cfg(test)]
mod agent_test_support;

#[cfg(test)]
mod agent_tests;

#[cfg(test)]
mod blocks_if_tests;

#[cfg(test)]
mod blocks_repeat_tests;

#[cfg(test)]
mod cancel_tests;

#[cfg(test)]
mod expects_tests;

#[cfg(test)]
mod linear_tests;

#[cfg(test)]
mod marker_tests;

#[cfg(test)]
mod notify_tests;

#[cfg(test)]
mod resume_tests;

#[cfg(test)]
mod run_action_verb_tests;

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T4.1-T4.2), not a TS port
// confidence: high
// todos: 0
// notes: semantics mirror Node engine/{walk,interpreter}.ts + walk.ts blocks;
//        ask_agent/ask_me verb impls land in T4.3/T5.1.
