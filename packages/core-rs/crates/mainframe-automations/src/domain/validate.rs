//! Plain-language, scope-aware validation (T1.3). Every issue is pinned to
//! the offending stepId (`None` only for automation-level issues) with a
//! message a non-programmer can act on.

use std::collections::{BTreeSet, HashMap};

use serde::Serialize;

use super::automation::AutomationDefinition;
use super::form::FormFieldType;
use super::scope::{
    TokenInfo, TokenType, builtin_tokens, comparator_wire_name, comparators_for, step_produces,
    step_refs, trigger_tokens,
};
use super::step::Step;
use super::token::{TOKEN_STEP_BUILTIN, TOKEN_STEP_CURRENT, TokenRef};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationError {
    /// `None` for automation-level issues (serialized as `null`, Node parity).
    pub step_id: Option<String>,
    pub message: String,
}

struct Ctx {
    /// Every (stepId, output) produced anywhere in the definition, for
    /// distinguishing "comes later" from "no longer exists".
    all_produced: HashMap<(String, String), TokenInfo>,
    /// Pre-order position of every step id.
    order: HashMap<String, usize>,
    errors: Vec<ValidationError>,
}

impl Ctx {
    fn push(&mut self, step_id: &str, message: String) {
        self.errors.push(ValidationError {
            step_id: Some(step_id.to_string()),
            message,
        });
    }
}

pub fn validate(definition: &AutomationDefinition) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    if definition.steps.is_empty() {
        errors.push(ValidationError {
            step_id: None,
            message: "Add at least one step.".to_string(),
        });
    }

    let mut seen = BTreeSet::new();
    let mut duplicated = BTreeSet::new();
    for_each_step(&definition.steps, &mut |step| {
        let id = step.id();
        if id.trim().is_empty() {
            errors.push(ValidationError {
                step_id: Some(id.to_string()),
                message: "Every step needs an id.".to_string(),
            });
        } else if !seen.insert(id.to_string()) {
            duplicated.insert(id.to_string());
        }
    });
    for id in &duplicated {
        errors.push(ValidationError {
            step_id: Some(id.clone()),
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
        all_produced,
        order,
        errors,
    };
    let mut scope = builtin_tokens();
    scope.extend(trigger_tokens(&definition.triggers));
    walk(&definition.steps, &mut scope, &mut ctx);
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

fn walk(steps: &[Step], scope: &mut Vec<TokenInfo>, ctx: &mut Ctx) {
    for step in steps {
        for token_ref in step_refs(step) {
            check_ref(step, token_ref, scope, ctx);
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
            Step::If(s) => {
                for condition in &s.conditions {
                    let Some(found) = lookup(scope, &condition.token) else {
                        continue; // the missing ref already got its own error
                    };
                    if !comparators_for(found.token_type).contains(&condition.comparator) {
                        ctx.push(
                            step.id(),
                            format!(
                                "\"{}\" doesn't work on a {} value — pick a different comparator.",
                                comparator_wire_name(condition.comparator),
                                found.token_type.describe()
                            ),
                        );
                    }
                }
                let mut then_scope = scope.clone();
                walk(&s.then, &mut then_scope, ctx);
                let mut otherwise_scope = scope.clone();
                walk(&s.otherwise, &mut otherwise_scope, ctx);
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
                let mut inner_scope = scope.clone();
                inner_scope.push(TokenInfo {
                    step_id: TOKEN_STEP_CURRENT.to_string(),
                    output: "item".to_string(),
                    token_type: TokenType::Text,
                    label: "Current item".to_string(),
                    source: "Repeat".to_string(),
                });
                walk(&s.steps, &mut inner_scope, ctx);
                // Isolated: nothing produced inside leaks after the block.
            }
            _ => scope.extend(step_produces(step)),
        }
    }
}

fn check_form_fields(step_id: &str, step: &super::step::AskMeStep, ctx: &mut Ctx) {
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
        message,
    });
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T1.3), not a TS port
// confidence: high
// todos: 0
// notes: scope semantics mirror Node's token-scope.ts walk (If leaks, Repeat isolates).
