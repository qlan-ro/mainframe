//! run_action verb (Node verbs/run-action.ts makeRunActionExecutor): renders
//! every ChipText param into one joined string (Decision 9) EXCEPT
//! run_command's `script`, which keeps chip boundaries as raw
//! `{literal}|{chip}` parts so A1's per-chip env-var injection applies.

use std::sync::Arc;

use serde_json::{Map, Value};

use crate::actions::{ActionCtx, ActionRegistry};
use crate::credentials::CredentialStore;
use crate::domain::{ChipPart, ChipText, RunActionStep};
use crate::ports::ProjectRegistry;
use crate::store::{AutomationStore, RunStore};
use crate::tokens::{Scope, render};

use super::{StepOutcome, VerbContext};

/// The only two actions whose input schema declares `outputAs` (contract §5).
const ACTIONS_WITH_OUTPUT_AS: [&str; 2] = ["run_command", "files.read"];

pub struct RunActionVerb {
    registry: Arc<ActionRegistry>,
    credentials: Arc<dyn CredentialStore>,
    projects: Arc<dyn ProjectRegistry>,
    runs: RunStore,
    automations: AutomationStore,
}

impl RunActionVerb {
    pub fn new(
        registry: Arc<ActionRegistry>,
        credentials: Arc<dyn CredentialStore>,
        projects: Arc<dyn ProjectRegistry>,
        runs: RunStore,
        automations: AutomationStore,
    ) -> Self {
        Self {
            registry,
            credentials,
            projects,
            runs,
            automations,
        }
    }

    pub async fn execute(&self, step: &RunActionStep, ctx: VerbContext<'_>) -> StepOutcome {
        let action = match self.registry.resolve(&step.action_id) {
            Ok(action) => action,
            Err(err) => return StepOutcome::Failed { error: err.0 },
        };

        let creds = match &step.credential {
            None => None,
            Some(label) => match self.credentials.get(label).await {
                Some(creds) => Some(creds),
                None => {
                    return StepOutcome::Failed {
                        error: format!(
                            "credential '{label}' not found — add it via PUT /api/automation-credentials/{label}"
                        ),
                    };
                }
            },
        };

        let input = build_action_input(step, ctx.scope);
        let action_ctx = ActionCtx {
            creds,
            credential_label: step.credential.clone(),
            idempotency_key: format!("{}:{}", ctx.run_id, ctx.step_ref),
            project_root: self.resolve_project_root(ctx.run_id).await,
            // Neither engine populates run-in `worktree` yet (Node parity —
            // ActionCtx.worktreePath is never set); run_command fails loudly.
            worktree_path: None,
        };

        match action.execute(&input, &action_ctx).await {
            Ok(outputs) => StepOutcome::Completed {
                outputs: outputs
                    .into_iter()
                    .map(|(name, value)| (name, value.to_json()))
                    .collect(),
            },
            Err(err) => StepOutcome::Failed { error: err.0 },
        }
    }

    /// Node service.resolveProjectRoot: run → automation → its project.
    async fn resolve_project_root(&self, run_id: &str) -> String {
        let automation = match self.runs.get_run(run_id).await {
            Ok(Some(run)) => self
                .automations
                .get(&run.automation_id)
                .await
                .ok()
                .flatten(),
            _ => None,
        };
        let project_id = automation.and_then(|record| record.project_id);
        self.projects
            .resolve_project_root(project_id.as_deref())
            .await
    }
}

/// Every param renders to one string; run_command's `script` keeps chip
/// boundaries (A1). `outputAs` is merged only for the two actions that
/// declare it — injecting it into every action would corrupt e.g.
/// notion.add_row's catchall property schema.
pub(crate) fn build_action_input(step: &RunActionStep, scope: &Scope<'_>) -> Value {
    let mut input = Map::new();
    for (key, chip_text) in &step.params {
        let value = if step.action_id == "run_command" && key == "script" {
            script_parts(chip_text, scope)
        } else {
            Value::String(render(chip_text, scope))
        };
        input.insert(key.clone(), value);
    }
    if let Some(output_as) = step.output_as
        && ACTIONS_WITH_OUTPUT_AS.contains(&step.action_id.as_str())
        && let Ok(value) = serde_json::to_value(output_as)
    {
        input.insert("outputAs".to_string(), value);
    }
    Value::Object(input)
}

/// A1: each token part becomes its own `{chip}` entry — never spliced into a
/// shared string with literal text. Unset tokens render empty (T3.1 rule).
fn script_parts(chip_text: &ChipText, scope: &Scope<'_>) -> Value {
    Value::Array(
        chip_text
            .iter()
            .map(|part| match part {
                ChipPart::Text(literal) => serde_json::json!({ "literal": literal }),
                ChipPart::Token { token } => {
                    let chip = scope
                        .resolve(token)
                        .map(|value| value.coerce_to_string())
                        .unwrap_or_default();
                    serde_json::json!({ "chip": chip })
                }
            })
            .collect(),
    )
}

// PORT STATUS: packages/core/src/automations/verbs/run-action.ts (100 lines)
// confidence: high
// todos: 0
// notes: input validation is each action's own strict serde parse (Node used
//        zod safeParse here); path expansion lives in actions::expand_user_path.
