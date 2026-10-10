//! Interpreter: replay-based `advance()` over the frozen
//! `checkpoint.definition` — skip committed steps, execute the first live one,
//! commit, repeat. Verbs are injected via `VerbPorts` so the walk stays
//! testable with fakes.

pub(crate) mod advance;
pub(crate) mod agent;
mod agent_settle;
pub(crate) mod blocks;
pub(crate) mod blocks_concurrent;
pub(crate) mod blocks_concurrent_repeat;
pub(crate) mod blocks_parallel;
pub(crate) mod checkpoint;
mod deadline;
pub(crate) mod expects;
pub(crate) mod markers;
pub(crate) mod notify_verb;
mod out_of_band;
pub(crate) use out_of_band::SettleError;
#[cfg(test)]
mod out_of_band_settle_tests;
pub(crate) mod run_action_verb;
mod run_locks;
pub(crate) mod walk;

pub use advance::{Interpreter, InterpreterDeps};
pub use agent::AgentVerb;
pub use notify_verb::NotifyVerb;
pub use run_action_verb::RunActionVerb;

use serde_json::{Map, Value};

use crate::domain::{AskAgentStep, AskMeStep, NotifyStep, RunActionStep};
use crate::error::StoreError;
use crate::tokens::{NameMap, Scope};

pub(crate) use mainframe_types::BoxFuture;

/// One verb execution's result.
#[derive(Debug, Clone, PartialEq)]
pub enum StepOutcome {
    Completed { outputs: Map<String, Value> },
    Wait { wake_at: Option<i64> },
    Failed { error: String },
}

/// Result of walking one step sequence to the end, a park point, or a hard
/// failure.
#[derive(Debug, Clone, PartialEq)]
pub enum WalkResult {
    Done,
    Parked,
    Failed {
        error: String,
    },
    /// A `break` fired. Propagates up through nested frames — `if` arms carry
    /// it outward, `repeat`/`loop` catch it and finish as `Done`. Validation
    /// guarantees an enclosing block exists, so it never reaches the top.
    Broke,
}

/// What a verb sees: run/step identity plus the frame's token scope.
/// Cancellation is structural — the interpreter drops the walk future on
/// `cancel_run`, so no cooperative signal is threaded through.
pub struct VerbContext<'a> {
    pub run_id: &'a str,
    pub step_ref: &'a str,
    pub scope: &'a Scope<'a>,
    /// The `$name`s this step can address — the scope walk's, not a flat
    /// sweep (see `tokens::variables`).
    pub names: &'a NameMap,
}

/// Post-finalize hook: the CompletionEmitter turns a finalized
/// `succeeded|failed` run into the `automation.completed` event + chained
/// trigger fires. Runs after the terminal store write, outside it — a hook
/// failure can never un-finalize a run.
pub trait RunFinalizedHook: Send + Sync {
    fn on_finalized<'a>(&'a self, run: &'a crate::store::RunRecord) -> BoxFuture<'a, ()>;
}

/// Late-bound advance handle: the settle/respond paths re-enter the
/// interpreter after an external completion, but the interpreter owns the
/// VerbPorts that contain those verbs — a trait breaks the construction
/// cycle. `settle_out_of_band` writes a parked step's outcome and applies the
/// keepGoing policy (see `out_of_band.rs`).
pub(crate) trait RunAdvancer: Send + Sync {
    fn advance_run<'a>(&'a self, run_id: &'a str) -> BoxFuture<'a, Result<(), StoreError>>;
    fn settle_out_of_band<'a>(
        &'a self,
        run_id: &'a str,
        step_ref: &'a str,
        outcome: OutOfBandOutcome,
    ) -> BoxFuture<'a, Result<(), SettleError>>;
}

/// How a parked step ended when something other than the walk settled it.
pub(crate) enum OutOfBandOutcome {
    Succeeded(Map<String, Value>),
    Failed(String),
}

/// The four Do-verbs, injected. Dyn-safe via `BoxFuture` (native
/// async-fn-in-trait is not object safe).
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
mod agent_settle_concurrent_tests;

#[cfg(test)]
mod agent_tests;

#[cfg(test)]
mod blocks_concurrent_repeat_tests;

#[cfg(test)]
mod blocks_concurrent_tests;

#[cfg(test)]
mod blocks_parallel_tests;

#[cfg(test)]
mod blocks_if_tests;

#[cfg(test)]
mod variables_tests;

#[cfg(test)]
mod blocks_repeat_tests;

#[cfg(test)]
mod blocks_loop_tests;

#[cfg(test)]
mod blocks_retry_tests;

#[cfg(test)]
mod cancel_tests;

#[cfg(test)]
mod expects_tests;

#[cfg(test)]
mod find_step_by_id_tests;

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

#[cfg(test)]
mod wait_tests;
