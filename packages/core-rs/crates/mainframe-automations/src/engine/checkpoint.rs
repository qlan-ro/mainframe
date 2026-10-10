//! Checkpoint mutation + the per-frame token view.

use std::sync::Arc;

use serde_json::Value;

use crate::domain::TOKEN_STEP_TRIGGER;
use crate::ports::Clock;
use crate::store::{AutomationCheckpoint, RunTriggerKind};
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
    pub(crate) fn iteration(&self, index: usize, item: TokenValue) -> WalkFrame {
        let mut current_items = self.current_items.clone();
        current_items.push(item);
        WalkFrame {
            ref_suffix: format!("{}#{index}", self.ref_suffix),
            current_items,
        }
    }

    /// Just the suffix `iteration` would produce, without cloning `item`
    /// into a full frame — the concurrent scheduler checks far more indices
    /// than it ever admits, and a `TokenValue` clone per check added up.
    pub(crate) fn iteration_suffix(&self, index: usize) -> String {
        format!("{}#{index}", self.ref_suffix)
    }

    /// One condition-loop pass deeper. Same `#<i>` suffixing as `iteration`,
    /// but the `current` stack is left alone: a condition loop has no item, and
    /// pushing a placeholder would make `⟨current⟩` resolve inside it — either
    /// to nonsense, or shadowing the enclosing Repeat's real item.
    pub(crate) fn pass(&self, index: usize) -> WalkFrame {
        WalkFrame {
            ref_suffix: format!("{}#{index}", self.ref_suffix),
            current_items: self.current_items.clone(),
        }
    }
}

/// Builds the frame's flat token scope: trigger payload keys, every plain-ref
/// entry's outputs, this frame's own exact-suffix iteration entries under their
/// plain id (other iterations and deeper-nested entries stay invisible), and
/// the innermost `current` item.
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
