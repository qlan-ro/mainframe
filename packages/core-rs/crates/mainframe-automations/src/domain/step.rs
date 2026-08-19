//! Do-steps (contract §1): the `Step` enum and every block type (`if`,
//! `repeat`, `loop`, `retry`, `parallel`). The leaf verbs (`ask_agent`,
//! `ask_me`, `run_action`, `notify`, `set_variable`, `wait`) live in
//! `step_verbs.rs`, split out once `ParallelBlock` pushed this file over the
//! 300-line cap.

use serde::{Deserialize, Serialize};

use super::condition::{ConditionMatch, ConditionRow};
use super::is_false;
use super::step_verbs::{
    AskAgentStep, AskMeStep, NotifyStep, RunActionStep, SetVariableStep, WaitStep,
};
use super::token::TokenRef;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Step {
    AskAgent(AskAgentStep),
    AskMe(AskMeStep),
    RunAction(RunActionStep),
    Notify(NotifyStep),
    SetVariable(SetVariableStep),
    Wait(WaitStep),
    Break(BreakStep),
    If(IfBlock),
    Repeat(RepeatBlock),
    #[serde(rename = "loop")]
    Loop(LoopBlock),
    Retry(RetryBlock),
    Parallel(ParallelBlock),
}

impl Step {
    pub fn id(&self) -> &str {
        match self {
            Step::AskAgent(s) => &s.id,
            Step::AskMe(s) => &s.id,
            Step::RunAction(s) => &s.id,
            Step::Notify(s) => &s.id,
            Step::SetVariable(s) => &s.id,
            Step::Wait(s) => &s.id,
            Step::Break(s) => &s.id,
            Step::If(s) => &s.id,
            Step::Repeat(s) => &s.id,
            Step::Loop(s) => &s.id,
            Step::Retry(s) => &s.id,
            Step::Parallel(s) => &s.id,
        }
    }

    pub fn kind_name(&self) -> &'static str {
        match self {
            Step::AskAgent(_) => "ask_agent",
            Step::AskMe(_) => "ask_me",
            Step::RunAction(_) => "run_action",
            Step::Notify(_) => "notify",
            Step::SetVariable(_) => "set_variable",
            Step::Wait(_) => "wait",
            Step::Break(_) => "break",
            Step::If(_) => "if",
            Step::Repeat(_) => "repeat",
            Step::Loop(_) => "loop",
            Step::Retry(_) => "retry",
            Step::Parallel(_) => "parallel",
        }
    }

    pub fn keep_going(&self) -> bool {
        match self {
            Step::AskAgent(s) => s.keep_going,
            Step::AskMe(s) => s.keep_going,
            Step::RunAction(s) => s.keep_going,
            Step::Notify(s) => s.keep_going,
            Step::SetVariable(s) => s.keep_going,
            Step::Wait(s) => s.keep_going,
            Step::Break(s) => s.keep_going,
            Step::If(s) => s.keep_going,
            Step::Repeat(s) => s.keep_going,
            Step::Loop(s) => s.keep_going,
            Step::Retry(s) => s.keep_going,
            Step::Parallel(s) => s.keep_going,
        }
    }
}

/// Re-runs its body from the top when it fails.
///
/// Each attempt walks in its own frame, so a failed attempt's checkpoint
/// entries never shadow the next one's — without that the walk would skip the
/// already-`failed` step and report the retry as a success.
///
/// **Retrying re-runs side effects.** A body that opened a PR and then failed
/// opens a second one on the next attempt. There is no idempotence guard here:
/// the `idempotent` manifest flag is engine-internal and never reaches the
/// wire catalog, so the honest surfacing is the editor's copy, not a check
/// that would silently half-work. Prefer retrying reads and commands.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetryBlock {
    pub id: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub keep_going: bool,
    /// Total tries, including the first — `1` is "no retry".
    pub max_attempts: u32,
    pub steps: Vec<Step>,
}

/// Leaves the innermost enclosing loop or repeat. Validation rejects one that
/// has no enclosing block, so the walk never has to decide what a stray break
/// means.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BreakStep {
    pub id: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub keep_going: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LoopMode {
    /// Keep going while the conditions match.
    While,
    /// Keep going until the conditions match.
    Until,
}

/// A condition-driven loop — the counterpart to `Repeat`, which walks a list
/// resolved once before it starts and so cannot poll or converge.
///
/// The conditions are re-evaluated before each pass, against the PREVIOUS
/// pass's outputs — a body step writes a suffixed entry the block's own frame
/// cannot see, so the test runs in that pass's frame.
///
/// Before the first pass there is nothing to read, and the rule there is:
/// **if the condition's tokens don't resolve yet, run the pass.** Without it
/// "repeat while the build is running" would exit before running anything,
/// since the step producing that status lives inside the loop. It costs
/// `until` nothing — a goal provable from outside the loop still resolves, so
/// "poll until the build is green" still runs zero passes when it was already
/// green, which is the case a post-test loop gets wrong.
///
/// `max_iterations` is mandatory and capped at the same `MAX_REPEAT_ITEMS`
/// bound Repeat already lives with, so a loop introduces no new checkpoint
/// growth class: each pass writes its own suffixed step entries exactly as a
/// Repeat iteration does. Exhausting the bound FAILS the block rather than
/// exiting quietly — a poll that never went green must not read as one that
/// did.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoopBlock {
    pub id: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub keep_going: bool,
    pub mode: LoopMode,
    #[serde(rename = "match")]
    pub match_mode: ConditionMatch,
    pub conditions: Vec<ConditionRow>,
    pub max_iterations: u32,
    pub steps: Vec<Step>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IfBlock {
    pub id: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub keep_going: bool,
    #[serde(rename = "match")]
    pub match_mode: ConditionMatch,
    pub conditions: Vec<ConditionRow>,
    pub then: Vec<Step>,
    pub otherwise: Vec<Step>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepeatBlock {
    pub id: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub keep_going: bool,
    /// The list token to iterate (wire name `items`, not `over`).
    pub items: TokenRef,
    /// Absent or `1`: today's exact sequential behavior. `2..=32`: up to that
    /// many iterations run concurrently through the branch driver (Phase 4a).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub concurrency: Option<u32>,
    pub steps: Vec<Step>,
}

/// Heterogeneous concurrent block (Phase 4b): unlike Repeat's concurrency,
/// which runs the SAME body once per item, a branch here is authored
/// directly — every branch starts before the block parks, and it settles
/// wait-for-all exactly like a concurrent Repeat (`engine/blocks_concurrent.rs`
/// is the shared driver for both).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParallelBlock {
    pub id: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub keep_going: bool,
    pub branches: Vec<Vec<Step>>,
}

/// Recursively finds a step by id, descending into `if`'s then/otherwise,
/// `repeat`/`loop`/`retry`'s inner steps, and every `parallel` branch — the
/// same tree shape the walk traverses (Node parity:
/// automation-domain/tokens.ts `findStepById`).
pub fn find_step_by_id<'a>(steps: &'a [Step], step_id: &str) -> Option<&'a Step> {
    for step in steps {
        if step.id() == step_id {
            return Some(step);
        }
        let nested = match step {
            Step::If(block) => find_step_by_id(&block.then, step_id)
                .or_else(|| find_step_by_id(&block.otherwise, step_id)),
            Step::Repeat(block) => find_step_by_id(&block.steps, step_id),
            Step::Loop(block) => find_step_by_id(&block.steps, step_id),
            Step::Retry(block) => find_step_by_id(&block.steps, step_id),
            Step::Parallel(block) => block
                .branches
                .iter()
                .find_map(|branch| find_step_by_id(branch, step_id)),
            _ => None,
        };
        if nested.is_some() {
            return nested;
        }
    }
    None
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T1.1), not a TS port
// confidence: high
// todos: 0
// notes: wire truth = packages/types/src/automation.ts; A9 attachments included.
