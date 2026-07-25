//! The `$name` half of validation — unresolved references and set-variable
//! name collisions, checked against the namespace in scope at each step
//! (Node parity: automation-domain/validate.ts).

use crate::tokens::variables::{NameMap, extract_variable_refs};

use super::step::Step;
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
        Step::AskMe(_) | Step::If(_) | Step::Repeat(_) => Vec::new(),
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

/// A set-variable step's own name: an identifier (Node's `VARIABLE_NAME` =
/// `^[a-z_][a-z0-9_]*$`) that nothing already in front of it answers to.
pub(crate) fn set_variable_name_issue(name: &str, names: &NameMap) -> Option<String> {
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
    if names.contains_key(trimmed) {
        return Some(format!(
            "Another value in scope is already called ${trimmed} — rename one of them."
        ));
    }
    None
}

// PORT STATUS: TS port of packages/types/src/automation-domain/validate.ts (T6)
// confidence: high
// todos: 0
// notes: split from validate.rs to keep both files inside the 300-line cap.
