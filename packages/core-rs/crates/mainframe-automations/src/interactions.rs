//! Form pause/respond (T5.1, Node verbs/ask-me.ts): the ask_me verb creates
//! a pending interaction and parks; `InteractionService::respond` validates,
//! claims `pending→answered` + writes the answers into the checkpoint in ONE
//! transaction (`InteractionStore::resolve_interaction`, contract §3), then
//! advances. No timeouts — interactions never expire (contract §9).

use std::sync::Arc;

use serde_json::{Map, Value};

use crate::domain::AskMeStep;
use crate::engine::checkpoint::set_step;
use crate::engine::{RunAdvancer, StepOutcome, VerbContext};
use crate::error::StoreError;
use crate::ports::{
    AutomationEvent, EventSink, Notification, NotificationLinks, Notifier, to_interaction_summary,
};
use crate::store::{
    AutomationStore, InteractionRecord, InteractionStatus, InteractionStore, RunStore, StepStatus,
};

mod form;

pub(crate) use form::validate_form;

#[derive(Debug, thiserror::Error)]
pub enum InteractionError {
    #[error("interaction not found: {0}")]
    NotFound(String),
    #[error("interaction already answered")]
    AlreadyAnswered,
    #[error("interaction already cancelled")]
    AlreadyCancelled,
    /// Field-level validation errors, joined for the wire like Node's
    /// `invalid response: ...`.
    #[error("invalid response: {}", errors.join("; "))]
    Invalid { errors: Vec<String> },
    #[error(transparent)]
    Store(#[from] StoreError),
}

/// VerbPorts.ask_me. AskMeStep has no ChipText fields (title/labels are
/// plain strings) — nothing to render.
pub struct AskMeVerb {
    interactions: InteractionStore,
    runs: RunStore,
    automations: AutomationStore,
    events: Arc<dyn EventSink>,
    notifier: Arc<dyn Notifier>,
}

impl AskMeVerb {
    pub fn new(
        interactions: InteractionStore,
        runs: RunStore,
        automations: AutomationStore,
        events: Arc<dyn EventSink>,
        notifier: Arc<dyn Notifier>,
    ) -> Self {
        Self {
            interactions,
            runs,
            automations,
            events,
            notifier,
        }
    }

    pub async fn execute(&self, step: &AskMeStep, ctx: VerbContext<'_>) -> StepOutcome {
        let existing = match self
            .interactions
            .find_pending_for_step(ctx.run_id, ctx.step_ref)
            .await
        {
            Ok(existing) => existing,
            Err(err) => return failed(err),
        };
        let fresh = existing.is_none();
        let record = match existing {
            Some(record) => record,
            None => match self
                .interactions
                .create(ctx.run_id, ctx.step_ref, &step.title, step.fields.clone())
                .await
            {
                Ok(record) => record,
                Err(err) => return failed(err),
            },
        };

        if let Err(outcome) = self.park(step, &ctx, &record).await {
            return outcome;
        }
        if fresh {
            self.events.emit(AutomationEvent::InteractionCreated {
                interaction: to_interaction_summary(&record),
            });
            self.send_notification(ctx.run_id, &step.title).await;
        }
        StepOutcome::Wait { wake_at: None }
    }

    /// Parks the entry `waiting` + stamps the interactionId BEFORE the
    /// created event goes out, so a respond can never hit a checkpoint that
    /// has no entry to answer.
    async fn park(
        &self,
        step: &AskMeStep,
        ctx: &VerbContext<'_>,
        record: &InteractionRecord,
    ) -> Result<(), StepOutcome> {
        let (step_ref, step_id) = (ctx.step_ref.to_string(), step.id.clone());
        let interaction_id = record.id.clone();
        let parked = self
            .runs
            .patch_checkpoint(ctx.run_id, move |cp| {
                set_step(
                    cp,
                    &step_ref,
                    &step_id,
                    "ask_me",
                    StepStatus::Waiting,
                    None,
                    None,
                );
                if let Some(entry) = cp.steps.get_mut(&step_ref) {
                    entry.interaction_id = Some(interaction_id);
                }
                cp.wake_at = None;
            })
            .await;
        match parked {
            Ok(_) => Ok(()),
            Err(StoreError::TerminalRun { .. }) => {
                // Cancel raced the pause: finalize already swept pendings,
                // so sweep the row created after it. The walk's own commit
                // hits the same A8 guard and unwinds.
                if let Err(err) = self.interactions.cancel_pending_for_run(ctx.run_id).await {
                    tracing::warn!(run_id = ctx.run_id, error = %err, "ask_me cancel-race cleanup failed");
                }
                Err(StepOutcome::Wait { wake_at: None })
            }
            Err(err) => Err(failed(err)),
        }
    }

    /// Best-effort attention ping (T5.1): automation name as title, the form
    /// title as body. Never fails the pause.
    async fn send_notification(&self, run_id: &str, form_title: &str) {
        let run = match self.runs.get_run(run_id).await {
            Ok(Some(run)) => run,
            Ok(None) => return,
            Err(err) => {
                tracing::warn!(run_id, error = %err, "ask_me notification: run load failed");
                return;
            }
        };
        let title = match self.automations.get(&run.automation_id).await {
            Ok(Some(automation)) => automation.name,
            _ => run.automation_id.clone(),
        };
        let notification = Notification {
            run_id: run_id.to_string(),
            automation_id: run.automation_id.clone(),
            title,
            body: form_title.to_string(),
            links: NotificationLinks {
                run_id: run_id.to_string(),
                chat_ids: run.checkpoint.agent_chat_ids(),
            },
        };
        if let Err(err) = self.notifier.notify(notification).await {
            tracing::warn!(run_id, error = %err, "automation notify push failed");
        }
    }
}

pub struct InteractionService {
    interactions: InteractionStore,
    advancer: Arc<dyn RunAdvancer>,
    events: Arc<dyn EventSink>,
}

impl InteractionService {
    pub fn new(
        interactions: InteractionStore,
        advancer: Arc<dyn RunAdvancer>,
        events: Arc<dyn EventSink>,
    ) -> Self {
        Self {
            interactions,
            advancer,
            events,
        }
    }

    pub async fn respond(
        &self,
        interaction_id: &str,
        payload: Map<String, Value>,
    ) -> Result<(), InteractionError> {
        let interaction = self
            .interactions
            .get(interaction_id)
            .await?
            .ok_or_else(|| InteractionError::NotFound(interaction_id.to_string()))?;
        match interaction.status {
            InteractionStatus::Answered => return Err(InteractionError::AlreadyAnswered),
            InteractionStatus::Cancelled => return Err(InteractionError::AlreadyCancelled),
            InteractionStatus::Pending => {}
        }

        let errors = validate_form(&interaction.fields, &payload);
        if !errors.is_empty() {
            return Err(InteractionError::Invalid { errors });
        }

        // One transaction: claim pending→answered + write the answers as the
        // parked step's Record output (contract §3).
        let claimed = self
            .interactions
            .resolve_interaction(interaction_id, payload)
            .await?;
        if !claimed {
            return Err(InteractionError::AlreadyAnswered);
        }

        self.events.emit(AutomationEvent::InteractionResolved {
            interaction_id: interaction.id.clone(),
            run_id: interaction.run_id.clone(),
        });
        self.advancer.advance_run(&interaction.run_id).await?;
        Ok(())
    }
}

fn failed(err: StoreError) -> StepOutcome {
    StepOutcome::Failed {
        error: err.to_string(),
    }
}

// PORT STATUS: packages/core/src/automations/verbs/ask-me.ts (139 lines)
// confidence: high
// todos: 0
// notes: Rust adds the T5.1 Notifier ping on pause (plan-mandated; Node has
//        no interaction push) and stamps interactionId on the entry.
