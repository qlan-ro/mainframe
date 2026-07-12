//! The typed value a token resolves to (plan T3.1):
//! `TokenValue = Text | Number(f64) | List | Record`.

use std::collections::BTreeMap;

use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub enum TokenValue {
    Text(String),
    Number(f64),
    List(Vec<TokenValue>),
    Record(BTreeMap<String, TokenValue>),
}

impl TokenValue {
    /// JSON → token value. `Null` is "unset" (`None`); booleans stringify
    /// the way JS renders them; null list items become empty text so list
    /// lengths survive the conversion.
    pub fn from_json(value: &Value) -> Option<TokenValue> {
        match value {
            Value::Null => None,
            Value::Bool(b) => Some(TokenValue::Text(b.to_string())),
            Value::Number(n) => n.as_f64().map(TokenValue::Number),
            Value::String(s) => Some(TokenValue::Text(s.clone())),
            Value::Array(items) => Some(TokenValue::List(
                items
                    .iter()
                    .map(|item| {
                        TokenValue::from_json(item).unwrap_or(TokenValue::Text(String::new()))
                    })
                    .collect(),
            )),
            Value::Object(entries) => Some(TokenValue::Record(
                entries
                    .iter()
                    .filter_map(|(k, v)| TokenValue::from_json(v).map(|tv| (k.clone(), tv)))
                    .collect(),
            )),
        }
    }

    pub fn to_json(&self) -> Value {
        match self {
            TokenValue::Text(s) => Value::String(s.clone()),
            TokenValue::Number(n) => serde_json::Number::from_f64(*n)
                .map(Value::Number)
                .unwrap_or(Value::Null),
            TokenValue::List(items) => {
                Value::Array(items.iter().map(TokenValue::to_json).collect())
            }
            TokenValue::Record(entries) => Value::Object(
                entries
                    .iter()
                    .map(|(k, v)| (k.clone(), v.to_json()))
                    .collect(),
            ),
        }
    }

    /// Literal substitution (contract Decision 9): text verbatim, numbers
    /// without a spurious `.0`, lists newline-joined, records as JSON.
    pub fn coerce_to_string(&self) -> String {
        match self {
            TokenValue::Text(s) => s.clone(),
            TokenValue::Number(n) => js_number_string(*n),
            TokenValue::List(items) => items
                .iter()
                .map(TokenValue::coerce_to_string)
                .collect::<Vec<_>>()
                .join("\n"),
            TokenValue::Record(_) => serde_json::to_string(&self.to_json()).unwrap_or_default(),
        }
    }
}

/// Mirrors JS `String(number)` for the values automations produce: integral
/// floats print without a decimal point (`String(5)` → `"5"`, never `"5.0"`).
pub fn js_number_string(n: f64) -> String {
    if n.is_nan() {
        return "NaN".to_string();
    }
    if n.is_infinite() {
        return if n > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    if n == 0.0 {
        return "0".to_string();
    }
    if n.fract() == 0.0 && n.abs() < 1e21 {
        return format!("{n:.0}");
    }
    format!("{n}")
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T3.1), not a TS port
// confidence: high
// todos: 0
// notes: coercion mirrors Node tokens/substitute.ts coerceToString (unset →
//        '' is the resolver's job — see substitute.rs).
