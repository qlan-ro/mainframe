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
