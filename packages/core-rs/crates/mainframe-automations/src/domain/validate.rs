//! Plain-language, scope-aware validation (T1.3). Every issue is pinned to
//! the offending stepId (`None` only for automation-level issues) with a
//! message a non-programmer can act on.

use std::collections::{BTreeSet, HashMap};

use serde::Serialize;

use crate::tokens::variables::build_variable_namespace;

use super::automation::AutomationDefinition;
use super::comparators::{comparator_wire_name, comparators_for};
use super::condition::ConditionRow;
use super::form::FormFieldType;
use super::scope::{
    TokenInfo, TokenType, builtin_tokens, current_item_info, step_produces, step_refs,
    trigger_tokens,
};
use super::step::Step;
use super::token::{TOKEN_STEP_BUILTIN, TOKEN_STEP_CURRENT, TokenRef};
use crate::engine::blocks::MAX_REPEAT_ITEMS;
/// A parked run costs nothing, so the cap is not a resource bound — it is a
/// typo guard. Anything longer than a week is a seconds/milliseconds mix-up
/// far more often than an intent; a genuinely long delay belongs on a
/// schedule trigger, not inside a run.
const MAX_WAIT_SECONDS: u32 = 7 * 24 * 60 * 60;

use super::validate_concurrency::{parallel_branch_factor, repeat_concurrency_factor};
use super::validate_variables::{
    set_variable_name_issue, unresolved_variable_names, variable_names_clashing_with,
};

/// How much an issue costs the user. Only `Error` blocks a save; a `Warning` is
/// reported and saved anyway.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ValidationLevel {
    Error,
    Warning,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationError {
    /// `None` for automation-level issues (serialized as `null`, Node parity).
    pub step_id: Option<String>,
    pub level: ValidationLevel,
    pub message: String,
}

pub(super) struct Ctx<'a> {
    /// Name clashes reach outside the walk's scope (a later sibling, the other
    /// `if` arm), so the whole definition stays in hand.
    definition: &'a AutomationDefinition,
    /// Every (stepId, output) produced anywhere in the definition, for
    /// distinguishing "comes later" from "no longer exists".
    all_produced: HashMap<(String, String), TokenInfo>,
    /// Pre-order position of every step id.
    order: HashMap<String, usize>,
    errors: Vec<ValidationError>,
}

impl Ctx<'_> {
    pub(super) fn push(&mut self, step_id: &str, message: String) {
        self.push_at(ValidationLevel::Error, step_id, message);
    }

    fn push_at(&mut self, level: ValidationLevel, step_id: &str, message: String) {
        self.errors.push(ValidationError {
            step_id: Some(step_id.to_string()),
            level,
            message,
        });
    }
}

/// CLAUDE.md's identifier charset (`^[a-zA-Z0-9_-]+$`) — enforced here
/// because the engine's marker scheme reserves `@` and `#` for itself.
fn is_valid_step_id(id: &str) -> bool {
    id.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn automation_error(message: &str) -> ValidationError {
    ValidationError {
        step_id: None,
        level: ValidationLevel::Error,
        message: message.to_string(),
    }
}

pub fn validate(definition: &AutomationDefinition) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    if definition.steps.is_empty() {
        errors.push(automation_error("Add at least one step."));
    }

    let mut seen = BTreeSet::new();
    let mut duplicated = BTreeSet::new();
    for_each_step(&definition.steps, &mut |step| {
        let id = step.id();
        if id.trim().is_empty() {
            errors.push(ValidationError {
                step_id: Some(id.to_string()),
                level: ValidationLevel::Error,
                message: "Every step needs an id.".to_string(),
            });
            return;
        }
        if !seen.insert(id.to_string()) {
            duplicated.insert(id.to_string());
        }
        // The charset is load-bearing beyond display, now: the marker scheme
        // (`@c`, `@w`, `@a`) and the `#`-suffix chain both assume a step id
        // never carries those characters itself.
        if !is_valid_step_id(id) {
            errors.push(ValidationError {
                step_id: Some(id.to_string()),
                level: ValidationLevel::Error,
                message: "Step ids can only use letters, numbers, underscores, and hyphens."
                    .to_string(),
            });
        }
    });
    for id in &duplicated {
        errors.push(ValidationError {
            step_id: Some(id.clone()),
            level: ValidationLevel::Error,
            message: format!("Two steps share the id \"{id}\" — step ids must be unique."),
        });
    }

    let mut order = HashMap::new();
    let mut position = 0usize;
    for_each_step(&definition.steps, &mut |step| {
        order.entry(step.id().to_string()).or_insert(position);
        position += 1;
    });
    let mut all_produced = HashMap::new();
    for_each_step(&definition.steps, &mut |step| {
        for token in step_produces(step) {
            all_produced
                .entry((token.step_id.clone(), token.output.clone()))
                .or_insert(token);
        }
    });

    let mut ctx = Ctx {
        definition,
        all_produced,
        order,
        errors,
    };
    let mut scope = builtin_tokens();
    scope.extend(trigger_tokens(&definition.triggers));
    walk(&definition.steps, &mut scope, &mut ctx, 1);
    super::validate_breaks::check_breaks(&definition.steps, &mut ctx);
    ctx.errors
}

fn for_each_step<'a>(steps: &'a [Step], visit: &mut dyn FnMut(&'a Step)) {
    for step in steps {
        visit(step);
        match step {
            Step::If(s) => {
                for_each_step(&s.then, visit);
                for_each_step(&s.otherwise, visit);
            }
            Step::Repeat(s) => for_each_step(&s.steps, visit),
            Step::Loop(s) => for_each_step(&s.steps, visit),
            Step::Retry(s) => for_each_step(&s.steps, visit),
            Step::Parallel(s) => {
                for branch in &s.branches {
                    for_each_step(branch, visit);
                }
            }
            _ => {}
        }
    }
}

fn lookup<'a>(scope: &'a [TokenInfo], token_ref: &TokenRef) -> Option<&'a TokenInfo> {
    scope
        .iter()
        .rev()
        .find(|t| t.step_id == token_ref.step_id && t.output == token_ref.output)
}

/// `If` and `Loop` share one condition shape (`ConditionRow`) and therefore
/// one comparator-compatibility check — a value's type decides which
/// comparators make sense on it regardless of which block is asking.
fn check_condition_comparators(
    step_id: &str,
    conditions: &[ConditionRow],
    scope: &[TokenInfo],
    ctx: &mut Ctx,
) {
    for condition in conditions {
        let Some(found) = lookup(scope, &condition.token) else {
            continue; // the missing ref already got its own error
        };
        if !comparators_for(found.token_type).contains(&condition.comparator) {
            ctx.push(
                step_id,
                format!(
                    "\"{}\" doesn't work on a {} value — pick a different comparator.",
                    comparator_wire_name(condition.comparator),
                    found.token_type.describe()
                ),
            );
        }
    }
}

/// `enclosing_concurrency` is the product of every enclosing concurrent
/// Repeat's own factor — the nested-fan-out cap needs it, since a Repeat two
/// levels deep multiplies with BOTH ancestors, not just its immediate parent.
fn walk(steps: &[Step], scope: &mut Vec<TokenInfo>, ctx: &mut Ctx, enclosing_concurrency: u32) {
    for step in steps {
        let names = build_variable_namespace(scope);
        for token_ref in step_refs(step) {
            check_ref(step, token_ref, scope, ctx);
        }
        // A warning, not an error: the interpreter leaves an unresolved `$name`
        // literal (tokens::substitute), so a prompt saying `cd $HOME && pnpm
        // build` runs exactly as written. Blocking the save on it made a
        // legitimate shell command unsaveable.
        for name in unresolved_variable_names(step, &names) {
            ctx.push_at(
                ValidationLevel::Warning,
                step.id(),
                format!("This step uses ${name}, but no earlier step defines it."),
            );
        }
        match step {
            Step::AskMe(s) => {
                check_form_fields(step.id(), s, ctx);
                scope.extend(step_produces(step));
            }
            Step::RunAction(s) => {
                if s.action_id.is_empty() {
                    ctx.push(step.id(), "Choose an action for this step.".to_string());
                }
                scope.extend(step_produces(step));
            }
            Step::Wait(s) => {
                if s.seconds == 0 {
                    ctx.push(step.id(), "Set how long this step should wait.".to_string());
                } else if s.seconds > MAX_WAIT_SECONDS {
                    ctx.push(
                        step.id(),
                        "A wait can be at most 7 days — check the unit.".to_string(),
                    );
                }
            }
            Step::SetVariable(s) => {
                let claimed = variable_names_clashing_with(ctx.definition, step.id());
                if let Some(message) = set_variable_name_issue(&s.name, &claimed) {
                    ctx.push(step.id(), message);
                }
                scope.extend(step_produces(step));
            }
            Step::If(s) => {
                check_condition_comparators(step.id(), &s.conditions, scope, ctx);
                let mut then_scope = scope.clone();
                walk(&s.then, &mut then_scope, ctx, enclosing_concurrency);
                let mut otherwise_scope = scope.clone();
                walk(
                    &s.otherwise,
                    &mut otherwise_scope,
                    ctx,
                    enclosing_concurrency,
                );
                // Both branches' outputs leak to later siblings once the
                // block closes.
                scope.extend(step_produces(step));
            }
            Step::Repeat(s) => {
                if let Some(found) = lookup(scope, &s.items)
                    && found.token_type != TokenType::List
                {
                    ctx.push(
                        step.id(),
                        format!(
                            "\"{}\" isn't a list — pick a value that produces a list to repeat over.",
                            found.label
                        ),
                    );
                }
                let factor =
                    repeat_concurrency_factor(step.id(), s.concurrency, enclosing_concurrency, ctx);
                let inner_concurrency = enclosing_concurrency.saturating_mul(factor);
                let mut inner_scope = scope.clone();
                inner_scope.push(current_item_info());
                walk(&s.steps, &mut inner_scope, ctx, inner_concurrency);
                // Isolated: nothing produced inside leaks after the block.
            }
            Step::Retry(s) => {
                if s.max_attempts == 0 {
                    ctx.push(
                        step.id(),
                        "Set how many times this should be tried.".to_string(),
                    );
                } else if s.max_attempts as usize > MAX_REPEAT_ITEMS {
                    ctx.push(
                        step.id(),
                        format!("A retry can run at most {MAX_REPEAT_ITEMS} attempts."),
                    );
                }
                let mut inner_scope = scope.clone();
                walk(&s.steps, &mut inner_scope, ctx, enclosing_concurrency);
                // Isolated like Repeat: a failed attempt's outputs must not
                // outlive the block, or a later step could read a value the
                // successful attempt never produced.
            }
            Step::Loop(s) => {
                if s.conditions.is_empty() {
                    ctx.push(
                        step.id(),
                        "Add a condition — a loop with none would never stop.".to_string(),
                    );
                }
                if s.max_iterations == 0 {
                    ctx.push(
                        step.id(),
                        "Set how many passes this loop may run.".to_string(),
                    );
                } else if s.max_iterations as usize > MAX_REPEAT_ITEMS {
                    ctx.push(
                        step.id(),
                        format!("A loop can run at most {MAX_REPEAT_ITEMS} passes."),
                    );
                }
                check_condition_comparators(step.id(), &s.conditions, scope, ctx);
                let mut inner_scope = scope.clone();
                walk(&s.steps, &mut inner_scope, ctx, enclosing_concurrency);
                // Isolated like Repeat: a pass's outputs don't outlive the block.
            }
            Step::Parallel(s) => {
                let factor = parallel_branch_factor(
                    step.id(),
                    s.branches.len() as u32,
                    enclosing_concurrency,
                    ctx,
                );
                let inner_concurrency = enclosing_concurrency.saturating_mul(factor);
                for branch in &s.branches {
                    let mut branch_scope = scope.clone();
                    walk(branch, &mut branch_scope, ctx, inner_concurrency);
                }
                // Isolated: no branch sees a sibling's outputs, and nothing
                // produced inside leaks after the block, matching Repeat.
            }
            _ => scope.extend(step_produces(step)),
        }
    }
}

fn check_form_fields(step_id: &str, step: &super::step_verbs::AskMeStep, ctx: &mut Ctx) {
    for field in &step.fields {
        let label = field.label.clone().unwrap_or_default();
        if label.is_empty() && field.key.is_empty() {
            ctx.push(step_id, "A form field needs a label.".to_string());
        }
        let is_choice = matches!(
            field.field_type,
            FormFieldType::Choice | FormFieldType::Multi
        );
        if is_choice && field.options.as_deref().is_none_or(|o| o.is_empty()) {
            let display = if label.is_empty() {
                field.key.clone()
            } else {
                label
            };
            ctx.push(
                step_id,
                format!("\"{display}\" is a choice with no options."),
            );
        }
    }
}

fn check_ref(step: &Step, token_ref: &TokenRef, scope: &[TokenInfo], ctx: &mut Ctx) {
    if token_ref.step_id == TOKEN_STEP_BUILTIN {
        return;
    }
    if lookup(scope, token_ref).is_some() {
        return;
    }
    let message = if token_ref.step_id == TOKEN_STEP_CURRENT {
        "The \"Current item\" value only exists inside a Repeat block.".to_string()
    } else if let Some(found) = ctx
        .all_produced
        .get(&(token_ref.step_id.clone(), token_ref.output.clone()))
    {
        let producer = ctx.order.get(&found.step_id);
        let consumer = ctx.order.get(step.id());
        if matches!((producer, consumer), (Some(p), Some(c)) if p > c) {
            format!(
                "This step uses \"{}\" from \"{}\", which comes later — move that step above this one.",
                found.label, found.source
            )
        } else {
            format!(
                "This step uses \"{}\" from \"{}\", which isn't available here.",
                found.label, found.source
            )
        }
    } else {
        "This step uses a value that no longer exists — pick a new one.".to_string()
    };
    ctx.errors.push(ValidationError {
        step_id: Some(step.id().to_string()),
        level: ValidationLevel::Error,
        message,
    });
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T1.3), not a TS port
// confidence: high
// todos: 0
// notes: scope semantics mirror Node's token-scope.ts walk (If leaks, Repeat isolates).
