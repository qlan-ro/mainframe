//! The `$name` half of validation — unresolved references and set-variable
//! name collisions, checked against the namespace in scope at each step
//! (the TypeScript copy is packages/types/src/automation-domain/validate.ts).

use std::collections::HashSet;

use crate::tokens::variables::{NameMap, extract_variable_refs, variable_name_for};

use super::automation::AutomationDefinition;
use super::scope::{output_name_ordinal, step_produces};
use super::step::{ScopeRule, Step};
use super::template::{ChipPart, ChipText};

/// Every free-text field a step carries — where both `{token}` parts and
/// `$name` refs live.
fn chip_texts(step: &Step) -> Vec<&ChipText> {
    match step {
        Step::AskAgent(s) => match &s.worktree {
            Some(worktree) => vec![&s.prompt, &worktree.branch_name],
            None => vec![&s.prompt],
        },
        Step::RunAction(s) => s.params.values().collect(),
        Step::Notify(s) => vec![&s.message],
        Step::SetVariable(s) => vec![&s.value],
        Step::AskMe(_)
        | Step::Wait(_)
        | Step::Break(_)
        | Step::If(_)
        | Step::Repeat(_)
        | Step::Loop(_)
        | Step::Retry(_)
        | Step::Parallel(_) => Vec::new(),
    }
}

/// Names a step's text refers to that nothing upstream defines. Deduped, so
/// a name repeated three times reports once.
pub(crate) fn unresolved_variable_names(step: &Step, names: &NameMap) -> Vec<String> {
    let mut unresolved: Vec<String> = Vec::new();
    for part in chip_texts(step).into_iter().flatten() {
        let ChipPart::Text(text) = part else { continue };
        for variable in extract_variable_refs(text) {
            if !names.contains_key(&variable.name) && !unresolved.contains(&variable.name) {
                unresolved.push(variable.name);
            }
        }
    }
    unresolved
}

/// Every name one step claims: a set-value's own name, or each output of a
/// producing step at the ordinal it minted (`outputName`).
fn names_claimed_by(step: &Step, into: &mut HashSet<String>) {
    match step {
        Step::SetVariable(s) => {
            let trimmed = s.name.trim();
            if !trimmed.is_empty() {
                into.insert(trimmed.to_string());
            }
        }
        Step::AskAgent(_) | Step::AskMe(_) | Step::RunAction(_) => {
            let suffix = match output_name_ordinal(step) {
                Some(ordinal) => format!("_{ordinal}"),
                None => String::new(),
            };
            for info in step_produces(step) {
                into.insert(format!("{}{suffix}", variable_name_for(&info)));
            }
        }
        Step::Notify(_)
        | Step::Wait(_)
        | Step::Break(_)
        | Step::If(_)
        | Step::Repeat(_)
        | Step::Loop(_)
        | Step::Retry(_)
        | Step::Parallel(_) => {}
    }
}

/// Names claimed directly in this region: `if` arms belong to the region around
/// them, a `repeat` body is its own.
fn region_names(steps: &[Step], except: &str, into: &mut HashSet<String>) {
    for step in steps {
        if step.id() == except {
            continue;
        }
        match step.scope_rule() {
            ScopeRule::If => {
                for body in step.child_bodies() {
                    region_names(body, except, into);
                }
            }
            ScopeRule::Leaf => names_claimed_by(step, into),
            // Every repeat, loop and retry body is its own naming region, and
            // so is each parallel branch.
            ScopeRule::Repeat { .. } | ScopeRule::Loop | ScopeRule::Retry | ScopeRule::Parallel => {
            }
        }
    }
}

fn contains_step(steps: &[Step], step_id: &str) -> bool {
    steps.iter().any(|step| {
        step.id() == step_id
            || step
                .child_bodies()
                .into_iter()
                .any(|body| contains_step(body, step_id))
    })
}

/// The repeat, loop, retry or parallel-branch body containing `step_id`, or
/// `None` when the step sits in this region itself.
fn enclosing_repeat_body<'a>(steps: &'a [Step], step_id: &str) -> Option<&'a [Step]> {
    for step in steps {
        for body in step.child_bodies() {
            // `if` is not a region of its own; every other block body is.
            if step.scope_rule() == ScopeRule::If {
                if let Some(nested) = enclosing_repeat_body(body, step_id) {
                    return Some(nested);
                }
            } else if contains_step(body, step_id) {
                return Some(body);
            }
        }
    }
    None
}

/// Names a step cannot reuse: everything claimed in its own naming region and
/// in every region enclosing it, minus its own.
///
/// A region is the top level or a `repeat` body. `if` arms belong to the region
/// around them — both leak into scope once the block closes, so two arms each
/// defining `$summary` leave the second one unaddressable and every `$summary`
/// written for it renders empty. Two sibling repeat bodies are separate regions
/// and may reuse a name, which is what the interpreter already does.
pub(crate) fn variable_names_clashing_with(
    definition: &AutomationDefinition,
    step_id: &str,
) -> HashSet<String> {
    let mut names = HashSet::new();
    let mut steps: &[Step] = &definition.steps;
    loop {
        region_names(steps, step_id, &mut names);
        match enclosing_repeat_body(steps, step_id) {
            Some(body) => steps = body,
            None => return names,
        }
    }
}

/// A set-variable step's own name: an identifier (`^[a-z_][a-z0-9_]*$`, the
/// TypeScript copy's `VARIABLE_NAME`) that no other step in its naming
/// regions claims.
pub(crate) fn set_variable_name_issue(name: &str, claimed: &HashSet<String>) -> Option<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Some("Give this value a name.".to_string());
    }
    let mut chars = trimmed.chars();
    let head_ok = chars
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c == '_');
    let tail_ok = chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    if !head_ok || !tail_ok {
        return Some(
            "Use lowercase letters, numbers and underscores for a value name, starting with a letter."
                .to_string(),
        );
    }
    if claimed.contains(trimmed) {
        return Some(format!(
            "Another value in this automation is already called ${trimmed} — rename one of them."
        ));
    }
    None
}
