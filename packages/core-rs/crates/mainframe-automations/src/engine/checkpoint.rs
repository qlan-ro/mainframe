//! Checkpoint mutation + the per-frame token view (Node walk.ts `setStep` /
//! `stepsView` / `buildTokenContext`).

use std::sync::Arc;

use serde_json::{Map, Value};

use crate::domain::TOKEN_STEP_TRIGGER;
use crate::ports::Clock;
use crate::store::{
    AutomationCheckpoint, CheckpointStep, RunTriggerKind, StepStatus, epoch_ms_now,
};
use crate::tokens::{Scope, TokenValue};

/// Per-scope walk context: `ref_suffix` turns a plain step id into its
/// checkpoint stepRef (`#<i>` chained for nested Repeats); `current_items`
/// is the Repeat iteration stack `current` resolves against (innermost last).
#[derive(Clone, Default)]
pub(crate) struct WalkFrame {
    pub ref_suffix: String,
    pub current_items: Vec<TokenValue>,
}

impl WalkFrame {
    /// One Repeat iteration deeper: `#<i>` chains onto the suffix and the
    /// item joins the `current` stack.
    pub fn iteration(&self, index: usize, item: TokenValue) -> WalkFrame {
        let mut current_items = self.current_items.clone();
        current_items.push(item);
        WalkFrame {
            ref_suffix: format!("{}#{index}", self.ref_suffix),
            current_items,
        }
    }
}

/// Writes one stepRef entry. `outputs` land only on `succeeded` (a failed
/// re-run must not clobber earlier outputs); `startedAt` survives
/// transitions; `chatId`/`interactionId` are preserved — the running→waiting
/// rewrite must not drop what a verb stamped between commits.
pub(crate) fn set_step(
    checkpoint: &mut AutomationCheckpoint,
    step_ref: &str,
    step_id: &str,
    kind: &str,
    status: StepStatus,
    outputs: Option<Map<String, Value>>,
    error: Option<String>,
) {
    let now = epoch_ms_now();
    let existing = checkpoint.steps.get(step_ref);
    let terminal = matches!(
        status,
        StepStatus::Succeeded | StepStatus::Failed | StepStatus::Skipped
    );
    let entry = CheckpointStep {
        step_id: step_id.to_string(),
        kind: kind.to_string(),
        status,
        outputs: if status == StepStatus::Succeeded {
            outputs
        } else {
            existing.and_then(|e| e.outputs.clone())
        },
        error,
        started_at: existing.and_then(|e| e.started_at).or(Some(now)),
        finished_at: terminal.then_some(now),
        chat_id: existing.and_then(|e| e.chat_id.clone()),
        interaction_id: existing.and_then(|e| e.interaction_id.clone()),
    };
    checkpoint.steps.insert(step_ref.to_string(), entry);
}

/// The walk's wait commit (T4.3): a verb may park AND settle its entry
/// before the walk's own commit runs (a fast agent completion) — a terminal
/// entry must not be re-parked, nor its wakeAt re-armed.
pub(crate) fn park_step(
    checkpoint: &mut AutomationCheckpoint,
    step_ref: &str,
    step_id: &str,
    kind: &str,
    wake_at: Option<i64>,
) {
    let settled = checkpoint.steps.get(step_ref).is_some_and(|entry| {
        matches!(
            entry.status,
            StepStatus::Succeeded | StepStatus::Failed | StepStatus::Skipped
        )
    });
    if settled {
        return;
    }
    set_step(
        checkpoint,
        step_ref,
        step_id,
        kind,
        StepStatus::Waiting,
        None,
        None,
    );
    checkpoint.wake_at = wake_at;
}

/// Fails an EXISTING entry in place (the stale-`running` restart policy) —
/// unlike `set_step`, a missing entry is left missing.
pub(crate) fn fail_step_entry(checkpoint: &mut AutomationCheckpoint, step_ref: &str, error: &str) {
    if let Some(entry) = checkpoint.steps.get_mut(step_ref) {
        entry.status = StepStatus::Failed;
        entry.error = Some(error.to_string());
        entry.finished_at = Some(epoch_ms_now());
    }
}

/// Builds the frame's flat token scope (Node `buildTokenContext`+`stepsView`):
/// trigger payload keys, every plain-ref entry's outputs, this frame's own
/// exact-suffix iteration entries under their plain id (other iterations and
/// deeper-nested entries stay invisible), and the innermost `current` item.
pub(crate) fn build_scope(
    checkpoint: &AutomationCheckpoint,
    frame: &WalkFrame,
    clock: Arc<dyn Clock>,
) -> Scope<'static> {
    let mut scope = Scope::root(clock);
    bind_trigger_tokens(&mut scope, checkpoint);
    for (step_ref, entry) in &checkpoint.steps {
        let Some(plain_id) = visible_plain_id(step_ref, &frame.ref_suffix) else {
            continue;
        };
        let Some(outputs) = &entry.outputs else {
            continue;
        };
        for (output, value) in outputs {
            if let Some(token_value) = TokenValue::from_json(value) {
                scope.bind(plain_id, output, token_value);
            }
        }
    }
    if let Some(item) = frame.current_items.last() {
        scope.set_current(item.clone());
    }
    scope
}

/// Trigger-token exposure (domain `trigger_tokens`): a webhook delivery is one
/// `payload` object token (fields dig in — `⟨PR URL⟩` = `payload.pull_request
/// .html_url`); an event trigger spreads its flat `{result, chatId}` bag;
/// schedule/manual produce none.
fn bind_trigger_tokens(scope: &mut Scope<'static>, checkpoint: &AutomationCheckpoint) {
    let Some(payload) = &checkpoint.trigger.payload else {
        return;
    };
    match checkpoint.trigger.kind {
        RunTriggerKind::Webhook => {
            if let Some(token_value) = TokenValue::from_json(payload) {
                scope.bind(TOKEN_STEP_TRIGGER, "payload", token_value);
            }
        }
        _ => {
            if let Value::Object(fields) = payload {
                for (key, value) in fields {
                    if let Some(token_value) = TokenValue::from_json(value) {
                        scope.bind(TOKEN_STEP_TRIGGER, key, token_value);
                    }
                }
            }
        }
    }
}

/// The plain step id a checkpoint ref is visible under in this frame, if any.
fn visible_plain_id<'r>(step_ref: &'r str, ref_suffix: &str) -> Option<&'r str> {
    if !step_ref.contains('#') {
        return Some(step_ref);
    }
    if ref_suffix.is_empty() {
        return None;
    }
    step_ref
        .strip_suffix(ref_suffix)
        .filter(|plain| !plain.contains('#'))
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T4.1), not a TS port
// confidence: high
// todos: 0
// notes: set_step preserves chatId/interactionId (deliberate divergence from
//        Node's setStep, which rebuilds without them — Rust's T4.3 stamps
//        chatId on the entry itself); visibility mirrors Node stepsView.
