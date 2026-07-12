//! Typed comparator matrix for If blocks (contract §1, A3). `contains` is
//! polymorphic (text substring / list membership); `is_one_of` is the
//! opposite direction (a scalar operand tested against an array value). An
//! unset token never throws — every comparator evaluates it as false.

use crate::domain::{Comparator, ConditionMatch, ConditionRow, ConditionValue, ScalarValue};

use super::scope::Scope;
use super::value::{TokenValue, js_number_string};

pub fn evaluate(rows: &[ConditionRow], match_mode: ConditionMatch, scope: &Scope<'_>) -> bool {
    match match_mode {
        ConditionMatch::All => rows.iter().all(|row| eval_condition(scope, row)),
        ConditionMatch::Any => rows.iter().any(|row| eval_condition(scope, row)),
    }
}

fn eval_condition(scope: &Scope<'_>, row: &ConditionRow) -> bool {
    let Some(operand) = scope.resolve(&row.token) else {
        return false;
    };
    compare(&operand, row.comparator, row.value.as_ref())
}

/// These compare via a single scalar stringify/number coercion — an array
/// operand or value would silently compare by its joined string, so both
/// sides are rejected explicitly rather than coerced (the Node fix).
fn is_scalar_only(comparator: Comparator) -> bool {
    matches!(
        comparator,
        Comparator::Is
            | Comparator::IsNot
            | Comparator::StartsWith
            | Comparator::Eq
            | Comparator::Lt
            | Comparator::Gt
    )
}

fn compare(operand: &TokenValue, comparator: Comparator, value: Option<&ConditionValue>) -> bool {
    let operand_is_list = matches!(operand, TokenValue::List(_));
    let value_is_list = matches!(value, Some(ConditionValue::List(_)));
    if is_scalar_only(comparator) && (operand_is_list || value_is_list) {
        return false;
    }
    match comparator {
        Comparator::Is => operand.coerce_to_string() == value_string(value),
        Comparator::IsNot => operand.coerce_to_string() != value_string(value),
        Comparator::StartsWith => operand.coerce_to_string().starts_with(&value_string(value)),
        Comparator::Contains => match operand {
            TokenValue::List(items) => {
                let needle = value_string(value);
                items.iter().any(|item| item.coerce_to_string() == needle)
            }
            _ => operand.coerce_to_string().contains(&value_string(value)),
        },
        Comparator::Eq => operand_number(operand) == value_number(value),
        Comparator::Lt => operand_number(operand) < value_number(value),
        Comparator::Gt => operand_number(operand) > value_number(value),
        Comparator::IsEmpty => is_empty(operand),
        Comparator::NotEmpty => !is_empty(operand),
        Comparator::IsOneOf => match value {
            Some(ConditionValue::List(items)) => {
                let operand = operand.coerce_to_string();
                items.iter().any(|item| scalar_string(item) == operand)
            }
            _ => false,
        },
    }
}

/// The authored value's string form. A missing value (unreachable through a
/// validated definition) compares as a sentinel no real operand equals —
/// `is` misses and `is_not` holds, matching Node's `String(undefined)`
/// behavior without reproducing the literal "undefined" string.
fn value_string(value: Option<&ConditionValue>) -> String {
    match value {
        Some(ConditionValue::Text(s)) => s.clone(),
        Some(ConditionValue::Number(n)) => js_number_string(n.as_f64().unwrap_or(f64::NAN)),
        // Only reachable via `contains` (scalar-only comparators bail above);
        // mirror JS Array.prototype.toString (comma-joined).
        Some(ConditionValue::List(items)) => items
            .iter()
            .map(scalar_string)
            .collect::<Vec<_>>()
            .join(","),
        None => "\u{0}unset\u{0}".to_string(),
    }
}

fn scalar_string(value: &ScalarValue) -> String {
    match value {
        ScalarValue::Text(s) => s.clone(),
        ScalarValue::Number(n) => js_number_string(n.as_f64().unwrap_or(f64::NAN)),
    }
}

/// JS `Number()` coercion: numeric strings parse, blank is 0, anything else
/// is NaN — and NaN makes every eq/lt/gt false, exactly like Node.
fn operand_number(operand: &TokenValue) -> f64 {
    match operand {
        TokenValue::Number(n) => *n,
        TokenValue::Text(s) => js_parse_number(s),
        TokenValue::List(_) | TokenValue::Record(_) => f64::NAN,
    }
}

fn value_number(value: Option<&ConditionValue>) -> f64 {
    match value {
        Some(ConditionValue::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(ConditionValue::Text(s)) => js_parse_number(s),
        Some(ConditionValue::List(_)) | None => f64::NAN,
    }
}

fn js_parse_number(s: &str) -> f64 {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return 0.0;
    }
    trimmed.parse::<f64>().unwrap_or(f64::NAN)
}

/// Only lists and text have an emptiness (Node parity — a record or number
/// is never "empty", so `not_empty` holds for them).
fn is_empty(operand: &TokenValue) -> bool {
    match operand {
        TokenValue::List(items) => items.is_empty(),
        TokenValue::Text(s) => s.is_empty(),
        TokenValue::Number(_) | TokenValue::Record(_) => false,
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T3.2), not a TS port
// confidence: high
// todos: 0
// notes: mirrors Node engine/comparators.ts, including the scalar-only
//        array rejection and the null-operand short-circuit.
