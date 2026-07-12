//! Chip-text rendering: string parts splice verbatim, `{token}` parts
//! resolve through the scope and coerce (unset → empty string).

use crate::domain::ChipPart;

use super::scope::Scope;

pub fn render(parts: &[ChipPart], scope: &Scope<'_>) -> String {
    parts
        .iter()
        .map(|part| match part {
            ChipPart::Text(text) => text.clone(),
            ChipPart::Token { token } => scope
                .resolve(token)
                .map(|value| value.coerce_to_string())
                .unwrap_or_default(),
        })
        .collect()
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T3.1), not a TS port
// confidence: high
// todos: 0
// notes: mirrors Node tokens/substitute.ts renderChipText.
