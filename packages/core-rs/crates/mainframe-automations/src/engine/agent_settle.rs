//! Agent settle path: a finished chat is judged against the step's output
//! contract, then settled through `Interpreter::settle_out_of_band`, which
//! writes the outcome and re-advances. All writes ride the A8-guarded
//! RunStore, so a cancel that raced always wins.

use serde_json::{Map, Value};

use crate::domain::{ExpectedOutput, Step, find_step_by_id};
use crate::ports::{AgentOutcome, AgentPortError};
use crate::store::StepStatus;

use super::agent::{AgentVerb, WaitKey};
use super::expects::{build_correction_message, parse_expected};
use super::{OutOfBandOutcome, SettleError};

enum Verdict {
    Succeed(Map<String, Value>),
    Fail(String),
    /// A2 mismatch with retry budget left: send ONE corrective message into
    /// the same session and judge its outcome.
    Retry(String),
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
        let Some(expects) = self.load_waiting_expects(chat_id, &key).await else {
            return;
        };

        let mut outcome = outcome;
        let mut can_retry = true;
        loop {
            match judge(&outcome, &expects, chat_id, can_retry) {
                Verdict::Succeed(outputs) => {
                    self.remove_wait(chat_id);
                    return self
                        .settle_step(&key, OutOfBandOutcome::Succeeded(outputs))
                        .await;
                }
                Verdict::Fail(error) => {
                    self.remove_wait(chat_id);
                    return self
                        .settle_step(&key, OutOfBandOutcome::Failed(error))
                        .await;
                }
                Verdict::Retry(reason) => {
                    can_retry = false;
                    let correction = build_correction_message(&reason, &expects);
                    outcome = self.port.retry(chat_id, &correction).await;
                    // Cancel may have cleared the wait while we awaited.
                    if self.wait_key(chat_id).is_none() {
                        return;
                    }
                }
            }
        }
    }

    /// The run must be live and the entry still `waiting`, else the wait is
    /// stale: clear it and drop the outcome. Returns the step's A2 output
    /// contract; the failure policy is resolved when the outcome is written.
    async fn load_waiting_expects(
        &self,
        chat_id: &str,
        key: &WaitKey,
    ) -> Option<Vec<ExpectedOutput>> {
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
        Some(match step {
            Some(Step::AskAgent(ask)) => ask.expects.clone().unwrap_or_default(),
            _ => Vec::new(),
        })
    }

    async fn settle_step(&self, key: &WaitKey, outcome: OutOfBandOutcome) {
        let Some(advancer) = self.advancer.get() else {
            tracing::error!(run_id = key.run_id, "agent settle: no advancer bound");
            return;
        };
        let succeeded = matches!(outcome, OutOfBandOutcome::Succeeded(_));
        let Err(err) = advancer
            .settle_out_of_band(&key.run_id, &key.step_ref, outcome)
            .await
        else {
            return;
        };
        let run_id = key.run_id.as_str();
        match err {
            SettleError::Write(err) if succeeded => {
                tracing::error!(run_id, error = %err, "agent settle: succeed write failed");
            }
            SettleError::Write(err) => {
                tracing::error!(run_id, error = %err, "agent settle: fail write failed");
            }
            SettleError::Advance(err) => {
                tracing::error!(run_id, error = %err, "agent settle: advance failed");
            }
            SettleError::Finalize(err) => {
                tracing::error!(run_id, error = %err, "agent settle: run finalize failed");
            }
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
