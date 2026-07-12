//! Chip text (contract §1): `ChipPart = string | {token: TokenRef}` — a flat
//! untagged union, NOT a tagged `Text{text}|Token{token}` pair.

use serde::{Deserialize, Serialize};

use super::token::TokenRef;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged, deny_unknown_fields)]
pub enum ChipPart {
    Text(String),
    Token { token: TokenRef },
}

pub type ChipText = Vec<ChipPart>;

/// Every `TokenRef` used by a chip text, in order.
pub fn chip_tokens(parts: &[ChipPart]) -> Vec<&TokenRef> {
    parts
        .iter()
        .filter_map(|p| match p {
            ChipPart::Text(_) => None,
            ChipPart::Token { token } => Some(token),
        })
        .collect()
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T1.1), not a TS port
// confidence: high
// todos: 0
// notes: untagged serde reproduces the TS `string | {token}` union exactly.
