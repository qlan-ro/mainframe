//! notify verb (T5.2, Node verbs/notify.ts): render the message, hand a
//! Notification (title = automation name, links = runId + the checkpoint's
//! agent chatIds) to the Notifier port, best-effort — a delivery failure
//! logs and the step still completes. The production Notifier (T9.2) emits
//! the WS `automation.notification` event and pushes to mobile.

use std::sync::Arc;

use serde_json::Map;

use crate::domain::NotifyStep;
use crate::ports::{Notification, NotificationLinks, Notifier};
use crate::store::{AutomationStore, RunStore};
use crate::tokens::render;

use super::{StepOutcome, VerbContext};

pub struct NotifyVerb {
    runs: RunStore,
    automations: AutomationStore,
    notifier: Arc<dyn Notifier>,
}

impl NotifyVerb {
    pub fn new(runs: RunStore, automations: AutomationStore, notifier: Arc<dyn Notifier>) -> Self {
        Self {
            runs,
            automations,
            notifier,
        }
    }

    pub async fn execute(&self, step: &NotifyStep, ctx: VerbContext<'_>) -> StepOutcome {
        let run = match self.runs.get_run(ctx.run_id).await {
            Ok(Some(run)) => run,
            Ok(None) => {
                return StepOutcome::Failed {
                    error: format!("automation run not found: {}", ctx.run_id),
                };
            }
            Err(err) => {
                return StepOutcome::Failed {
                    error: err.to_string(),
                };
            }
        };

        // Node getAutomationName: fall back to the id when the row is gone.
        let title = match self.automations.get(&run.automation_id).await {
            Ok(Some(automation)) => automation.name,
            _ => run.automation_id.clone(),
        };
        let notification = Notification {
            run_id: ctx.run_id.to_string(),
            automation_id: run.automation_id.clone(),
            title,
            body: render(&step.message, ctx.scope),
            links: NotificationLinks {
                run_id: ctx.run_id.to_string(),
                chat_ids: run.checkpoint.agent_chat_ids(),
            },
        };
        if let Err(err) = self.notifier.notify(notification).await {
            tracing::warn!(run_id = ctx.run_id, error = %err, "automation notify push failed");
        }

        StepOutcome::Completed {
            outputs: Map::new(),
        }
    }
}

// PORT STATUS: packages/core/src/automations/verbs/notify.ts (108 lines)
// confidence: high
// todos: 0
// notes: Node emits the WS event inline and treats only push as the side
//        channel; Rust hands both to the Notifier port (T9.2 wires WS+push).
