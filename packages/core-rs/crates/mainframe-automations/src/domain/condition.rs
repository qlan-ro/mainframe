//! If-block conditions (contract §1/A3): ten comparators, `match: all|any`,
//! and the loosely-typed authored `value` (string, number, or array).

use serde::{Deserialize, Serialize};

use super::token::TokenRef;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Comparator {
    Is,
    IsNot,
    Contains,
    StartsWith,
    Eq,
    Lt,
    Gt,
    IsEmpty,
    NotEmpty,
    IsOneOf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConditionMatch {
    All,
    Any,
}

/// A scalar inside an `is_one_of` array value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ScalarValue {
    Text(String),
    Number(serde_json::Number),
}

/// The authored comparison value: `string | number | Array<string | number>`.
/// `serde_json::Number` preserves the authored integer/float form exactly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ConditionValue {
    Text(String),
    Number(serde_json::Number),
    List(Vec<ScalarValue>),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConditionRow {
    pub token: TokenRef,
    pub comparator: Comparator,
    /// Absent for `is_empty`/`not_empty`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<ConditionValue>,
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T1.1), not a TS port
// confidence: high
// todos: 0
// notes: comparator wire names are exactly contract §1's snake_case list.
