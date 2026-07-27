//! Chip-text rendering: `{token}` parts resolve through the scope, string
//! parts have their `$name` refs substituted, and both coerce (unset → empty
//! string).

use crate::domain::{ChipPart, TOKEN_STEP_CURRENT, TokenRef};

use super::scope::{Scope, dig};
use super::value::TokenValue;
use super::variables::{NameMap, NameTarget, extract_variable_refs};

pub fn render(parts: &[ChipPart], scope: &Scope<'_>, names: &NameMap) -> String {
    parts
        .iter()
        .map(|part| match part {
            ChipPart::Text(text) => render_variable_text(text, scope, names),
            ChipPart::Token { token } => scope
                .resolve(token)
                .map(|value| value.coerce_to_string())
                .unwrap_or_default(),
        })
        .collect()
}

/// Substitutes `$name` / `$name.path`. A name that is not in scope stays
/// literal (the user typed a `$` that means nothing here); a resolved name
/// with a failed dig renders empty, exactly as a field-dug token does.
fn render_variable_text(text: &str, scope: &Scope<'_>, names: &NameMap) -> String {
    let mut out = String::new();
    let mut cursor = 0;
    for variable in extract_variable_refs(text) {
        let Some(target) = names.get(&variable.name) else {
            continue;
        };
        out.push_str(&text[cursor..variable.start]);
        if let Some(value) = resolve(target, scope) {
            let dug = if variable.path.is_empty() {
                Some(value)
            } else {
                dig(&value, &variable.path.join("."))
            };
            out.push_str(&dug.map(|v| v.coerce_to_string()).unwrap_or_default());
        }
        cursor = variable.end;
    }
    out.push_str(&text[cursor..]);
    out
}

fn resolve(target: &NameTarget, scope: &Scope<'_>) -> Option<TokenValue> {
    match target {
        NameTarget::Ref(token) => scope.resolve(token),
        NameTarget::CurrentItem => scope.resolve(&TokenRef {
            step_id: TOKEN_STEP_CURRENT.to_string(),
            output: "item".to_string(),
            field: None,
        }),
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T3.1), not a TS port
// confidence: high
// todos: 0
// notes: mirrors Node tokens/substitute.ts renderChipText plus
//        automation-domain/variables.ts renderVariableText.
