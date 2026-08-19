//! Agent settle path (T4.3, Node verbs/agent-waits.ts): a finished chat
//! writes the step outcome into the checkpoint and re-advances. All writes
//! ride the A8-guarded RunStore, so a cancel that raced always wins.

use serde_json::{Map, Value};

use crate::domain::{ExpectedOutput, Step, enclosing_concurrent_branch, find_step_by_id};
use crate::error::StoreError;
use crate::ports::{AgentOutcome, AgentPortError, AutomationEvent, to_run_summary};
use crate::store::{StepStatus, epoch_ms_now};

use super::agent::{AgentVerb, WaitKey};
use super::checkpoint::{fail_step_entry, has_waiting_entry, recompute_wake_at};
use super::expects::{build_correction_message, parse_expected};
use super::markers::fail_enclosing_branch;

enum Verdict {
    Succeed(Map<String, Value>),
    Fail(String),
    /// A2 mismatch with retry budget left: send ONE corrective message into
    /// the same session and judge its outcome.
    Retry(String),
}

struct WaitingContext {
    keep_going: bool,
    expects: Vec<ExpectedOutput>,
    /// `(block_id, branch_ref_suffix)` of the nearest enclosing concurrent
    /// Repeat, if any — MUST-FIX 3: a failure that settles here bypasses the
    /// branch driver, so it has to write that branch's own marker itself.
    enclosing_branch: Option<(String, String)>,
}

impl AgentVerb {
    pub(crate) async fn settle(
        &self,
        chat_id: &str,
        outcome: Result<AgentOutcome, AgentPortError>,
    ) {
        // Registration gone = cancel already cleared this wait (A8): the
        // outcome is dropped, never written.
        let Some(key) = self.wait_key(chat_id) else {
            return;
        };
        let Some(context) = self.load_waiting_step(chat_id, &key).await else {
            return;
        };

        let mut outcome = outcome;
        let mut can_retry = true;
        loop {
            match judge(&outcome, &context.expects, chat_id, can_retry) {
                Verdict::Succeed(outputs) => {
                    self.remove_wait(chat_id);
                    return self.succeed_waiting_step(&key, outputs).await;
                }
                Verdict::Fail(error) => {
                    self.remove_wait(chat_id);
                    return self
                        .fail_waiting_step(
                            &key,
                            context.keep_going,
                            context.enclosing_branch.clone(),
                            &error,
                        )
                        .await;
                }
                Verdict::Retry(reason) => {
                    can_retry = false;
                    let correction = build_correction_message(&reason, &context.expects);
                    outcome = self.port.retry(chat_id, &correction).await;
                    // Cancel may have cleared the wait while we awaited.
                    if self.wait_key(chat_id).is_none() {
                        return;
                    }
                }
            }
        }
    }

    /// Node loadWaitingStep: the run must be live and the entry still
    /// `waiting`, else the wait is stale — clear it and drop the outcome.
    /// Returns the step's failure policy + A2 contract.
    async fn load_waiting_step(&self, chat_id: &str, key: &WaitKey) -> Option<WaitingContext> {
        let run = match self.store.get_run(&key.run_id).await {
            Ok(run) => run,
            Err(err) => {
                tracing::error!(run_id = key.run_id, error = %err, "agent settle: run load failed");
                return None;
            }
        };
        let stale = |reason: &str| {
            self.remove_wait(chat_id);
            tracing::warn!(
                chat_id,
                run_id = key.run_id,
                step_ref = key.step_ref,
                reason,
                "chat finished but the run is not waiting on this step"
            );
        };
        let Some(run) = run else {
            stale("run missing");
            return None;
        };
        if run.status.is_terminal() {
            stale("run terminal");
            return None;
        }
        let entry = run.checkpoint.steps.get(&key.step_ref);
        let Some(entry) = entry.filter(|e| e.status == StepStatus::Waiting) else {
            stale("entry not waiting");
            return None;
        };
        let step = find_step_by_id(&run.checkpoint.definition.steps, &entry.step_id);
        let ref_suffix = key
            .step_ref
            .strip_prefix(entry.step_id.as_str())
            .unwrap_or_default();
        Some(WaitingContext {
            keep_going: step.is_some_and(Step::keep_going),
            expects: match step {
                Some(Step::AskAgent(ask)) => ask.expects.clone().unwrap_or_default(),
                _ => Vec::new(),
            },
            enclosing_branch: enclosing_concurrent_branch(
                &run.checkpoint.definition.steps,
                &entry.step_id,
                ref_suffix,
            ),
        })
    }

    async fn succeed_waiting_step(&self, key: &WaitKey, outputs: Map<String, Value>) {
        let step_ref = key.step_ref.clone();
        let patched = self
            .store
            .patch_checkpoint(&key.run_id, move |cp| {
                if let Some(entry) = cp.steps.get_mut(&step_ref) {
                    entry.status = StepStatus::Succeeded;
                    entry.outputs = Some(outputs);
                    entry.error = None;
                    entry.finished_at = Some(epoch_ms_now());
                    entry.wake_at = None;
                }
                // A sibling branch may still be waiting — recompute rather
                // than clobbering its deadline with None.
                recompute_wake_at(cp);
            })
            .await;
        match patched {
            Ok(record) => {
                // A6 — the settled transition streams to the run view.
                self.events.emit(AutomationEvent::RunUpdated {
                    run: to_run_summary(&record),
                });
                self.advance(&key.run_id).await;
            }
            Err(StoreError::TerminalRun { .. }) => { /* cancel won (A8) */ }
            Err(err) => {
                tracing::error!(run_id = key.run_id, error = %err, "agent settle: succeed write failed");
            }
        }
    }

    /// Mirrors Node failWaitingStep, extended for Phase 4a concurrency
    /// (MUST-FIX 3): a leaf failing here bypasses `blocks_concurrent`'s own
    /// driver entirely, so if it lives inside a concurrent branch and
    /// `keepGoing` is false, this is the ONLY place that branch's own marker
    /// ever gets written — without it, the driver replays the leaf's
    /// `Failed` entry, skips past it (`walk.rs`'s terminal-skip), and
    /// launders the branch into `Succeeded`. `keepGoing: true` skips the
    /// marker write on purpose: it means the same thing here as everywhere
    /// else — don't fail the run over this step — so the driver's replay is
    /// left free to walk the branch's remaining steps and settle it Done,
    /// matching sequential `run_repeat`'s absorption of the same failure.
    ///
    /// A run with an outstanding `Waiting` entry must never finalize
    /// out-of-band, or it orphans whatever that entry is waiting on — so
    /// `keepGoing` is no longer the sole decider of advance-vs-finalize; a
    /// still-waiting sibling forces `advance()` regardless.
    async fn fail_waiting_step(
        &self,
        key: &WaitKey,
        keep_going: bool,
        enclosing_branch: Option<(String, String)>,
        error: &str,
    ) {
        let step_ref = key.step_ref.clone();
        let error_owned = error.to_string();
        let patched = self
            .store
            .patch_checkpoint(&key.run_id, move |cp| {
                fail_step_entry(cp, &step_ref, &error_owned);
                if !keep_going {
                    fail_enclosing_branch(cp, &enclosing_branch, &error_owned);
                }
                recompute_wake_at(cp);
            })
            .await;
        let record = match patched {
            Ok(record) => record,
            Err(StoreError::TerminalRun { .. }) => return,
            Err(err) => {
                tracing::error!(run_id = key.run_id, error = %err, "agent settle: fail write failed");
                return;
            }
        };
        self.events.emit(AutomationEvent::RunUpdated {
            run: to_run_summary(&record),
        });
        if keep_going || has_waiting_entry(&record.checkpoint) {
            self.advance(&key.run_id).await;
        } else {
            self.fail_run(&key.run_id, error).await;
        }
    }

    async fn advance(&self, run_id: &str) {
        let Some(advancer) = self.advancer.get() else {
            tracing::error!(run_id, "agent settle: no advancer bound");
            return;
        };
        if let Err(err) = advancer.advance_run(run_id).await {
            tracing::error!(run_id, error = %err, "agent settle: advance failed");
        }
    }

    async fn fail_run(&self, run_id: &str, error: &str) {
        let Some(advancer) = self.advancer.get() else {
            tracing::error!(run_id, "agent settle: no advancer bound");
            return;
        };
        if let Err(err) = advancer.fail_run(run_id, error).await {
            tracing::error!(run_id, error = %err, "agent settle: run finalize failed");
        }
    }
}

fn judge(
    outcome: &Result<AgentOutcome, AgentPortError>,
    expects: &[ExpectedOutput],
    chat_id: &str,
    can_retry: bool,
) -> Verdict {
    match outcome {
        Err(err) => Verdict::Fail(err.to_string()),
        Ok(AgentOutcome::Errored) => Verdict::Fail("agent chat error".to_string()),
        Ok(AgentOutcome::Interrupted) => Verdict::Fail("agent chat interrupted".to_string()),
        Ok(AgentOutcome::Completed { final_text }) => {
            let mut outputs = Map::new();
            outputs.insert("result".to_string(), Value::String(final_text.clone()));
            outputs.insert("chatId".to_string(), Value::String(chat_id.to_string()));
            if expects.is_empty() {
                return Verdict::Succeed(outputs);
            }
            match parse_expected(final_text, expects) {
                Ok(parsed) => {
                    outputs.extend(parsed);
                    Verdict::Succeed(outputs)
                }
                Err(reason) if can_retry => Verdict::Retry(reason),
                Err(reason) => {
                    Verdict::Fail(format!("agent did not return the expected JSON: {reason}"))
                }
            }
        }
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T4.3), not a TS port
// confidence: high
// todos: 0
// notes: mirrors Node AgentWaitService.onChatFinished/succeedWaitingStep/
//        failWaitingStep; A2 parse+retry extends the Completed arm in T4.4.
