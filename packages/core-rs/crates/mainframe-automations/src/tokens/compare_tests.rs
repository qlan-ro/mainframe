//! T3.2 — comparator matrix (contract §1/A3). Unset tokens are false, never
//! an error; scalar comparators reject array operands/values outright
//! (the Node fix — a joined-string coincidence must not match).

use std::sync::Arc;

use chrono::DateTime;
use serde_json::Number;

use crate::domain::{
    Comparator, ConditionMatch, ConditionRow, ConditionValue, ScalarValue, TokenRef,
};
use crate::ports::Clock;

use super::compare::evaluate;
use super::scope::Scope;
use super::value::TokenValue;

struct FakeClock;

impl Clock for FakeClock {
    fn now(&self) -> chrono::DateTime<chrono::FixedOffset> {
        DateTime::parse_from_rfc3339("2026-07-12T21:30:00+02:00").unwrap()
    }
}

fn scope_with(bindings: &[(&str, &str, TokenValue)]) -> Scope<'static> {
    let mut scope = Scope::root(Arc::new(FakeClock));
    for (step, output, value) in bindings {
        scope.bind(step, output, value.clone());
    }
    scope
}

fn cond(
    step: &str,
    output: &str,
    comparator: Comparator,
    value: Option<ConditionValue>,
) -> ConditionRow {
    ConditionRow {
        token: TokenRef {
            step_id: step.to_string(),
            output: output.to_string(),
            field: None,
        },
        comparator,
        value,
    }
}

fn text_value(s: &str) -> Option<ConditionValue> {
    Some(ConditionValue::Text(s.to_string()))
}

fn number_value(n: f64) -> Option<ConditionValue> {
    Some(ConditionValue::Number(Number::from_f64(n).unwrap()))
}

fn list_value(items: &[&str]) -> Option<ConditionValue> {
    Some(ConditionValue::List(
        items
            .iter()
            .map(|s| ScalarValue::Text(s.to_string()))
            .collect(),
    ))
}

fn eval_one(scope: &Scope<'_>, row: ConditionRow) -> bool {
    evaluate(&[row], ConditionMatch::All, scope)
}

#[test]
fn text_is_is_not_starts_with() {
    let scope = scope_with(&[("f", "action", TokenValue::Text("create new".to_string()))]);
    assert!(eval_one(
        &scope,
        cond("f", "action", Comparator::Is, text_value("create new"))
    ));
    assert!(!eval_one(
        &scope,
        cond("f", "action", Comparator::Is, text_value("update"))
    ));
    assert!(eval_one(
        &scope,
        cond("f", "action", Comparator::IsNot, text_value("update"))
    ));
    assert!(eval_one(
        &scope,
        cond("f", "action", Comparator::StartsWith, text_value("create"))
    ));
    assert!(!eval_one(
        &scope,
        cond("f", "action", Comparator::StartsWith, text_value("new"))
    ));
}

#[test]
fn contains_is_polymorphic() {
    let scope = scope_with(&[
        (
            "log",
            "output",
            TokenValue::Text("build passed cleanly".to_string()),
        ),
        (
            "cmd",
            "lines",
            TokenValue::List(vec![
                TokenValue::Text("alpha".to_string()),
                TokenValue::Number(3.0),
            ]),
        ),
    ]);
    // Text — substring.
    assert!(eval_one(
        &scope,
        cond("log", "output", Comparator::Contains, text_value("passed"))
    ));
    assert!(!eval_one(
        &scope,
        cond("log", "output", Comparator::Contains, text_value("failed"))
    ));
    // List — membership by stringified equality (number 3 matches "3").
    assert!(eval_one(
        &scope,
        cond("cmd", "lines", Comparator::Contains, text_value("alpha"))
    ));
    assert!(eval_one(
        &scope,
        cond("cmd", "lines", Comparator::Contains, text_value("3"))
    ));
    assert!(!eval_one(
        &scope,
        cond("cmd", "lines", Comparator::Contains, text_value("alp"))
    ));
}

#[test]
fn numbers_coerce_numeric_strings() {
    let scope = scope_with(&[
        ("run", "exitCode", TokenValue::Number(5.0)),
        ("form", "count", TokenValue::Text("5".to_string())),
        ("junk", "word", TokenValue::Text("abc".to_string())),
    ]);
    assert!(eval_one(
        &scope,
        cond("form", "count", Comparator::Eq, number_value(5.0))
    ));
    assert!(eval_one(
        &scope,
        cond("run", "exitCode", Comparator::Eq, text_value("5"))
    ));
    assert!(eval_one(
        &scope,
        cond("run", "exitCode", Comparator::Lt, text_value("10"))
    ));
    assert!(eval_one(
        &scope,
        cond("run", "exitCode", Comparator::Gt, number_value(4.5))
    ));
    assert!(!eval_one(
        &scope,
        cond("junk", "word", Comparator::Eq, number_value(0.0))
    ));
    assert!(!eval_one(
        &scope,
        cond("junk", "word", Comparator::Lt, number_value(1e9))
    ));
}

#[test]
fn list_and_text_emptiness() {
    let scope = scope_with(&[
        ("empty", "prs", TokenValue::List(vec![])),
        (
            "full",
            "prs",
            TokenValue::List(vec![TokenValue::Text("pr".to_string())]),
        ),
        ("blank", "note", TokenValue::Text(String::new())),
    ]);
    assert!(eval_one(
        &scope,
        cond("empty", "prs", Comparator::IsEmpty, None)
    ));
    assert!(!eval_one(
        &scope,
        cond("empty", "prs", Comparator::NotEmpty, None)
    ));
    assert!(eval_one(
        &scope,
        cond("full", "prs", Comparator::NotEmpty, None)
    ));
    assert!(eval_one(
        &scope,
        cond("blank", "note", Comparator::IsEmpty, None)
    ));
}

#[test]
fn is_one_of_tests_the_operand_against_an_array_value() {
    // The feature-spike gate: ⟨scope⟩ is_one_of ["xs","s"].
    let scope = scope_with(&[
        ("pick-feature", "scope", TokenValue::Text("xs".to_string())),
        ("other", "scope", TokenValue::Text("m".to_string())),
        ("run", "exitCode", TokenValue::Number(2.0)),
    ]);
    assert!(eval_one(
        &scope,
        cond(
            "pick-feature",
            "scope",
            Comparator::IsOneOf,
            list_value(&["xs", "s"])
        )
    ));
    assert!(!eval_one(
        &scope,
        cond(
            "other",
            "scope",
            Comparator::IsOneOf,
            list_value(&["xs", "s"])
        )
    ));
    // Cross-type: a number operand matches its stringified form.
    assert!(eval_one(
        &scope,
        cond(
            "run",
            "exitCode",
            Comparator::IsOneOf,
            list_value(&["1", "2"])
        )
    ));
    // A non-array value never matches.
    assert!(!eval_one(
        &scope,
        cond(
            "pick-feature",
            "scope",
            Comparator::IsOneOf,
            text_value("xs")
        )
    ));
}

#[test]
fn scalar_comparators_return_false_for_array_operands_and_values() {
    let scope = scope_with(&[
        (
            "list",
            "items",
            TokenValue::List(vec![TokenValue::Text("a".to_string())]),
        ),
        ("plain", "word", TokenValue::Text("a".to_string())),
    ]);
    for comparator in [
        Comparator::Is,
        Comparator::IsNot,
        Comparator::StartsWith,
        Comparator::Eq,
        Comparator::Lt,
        Comparator::Gt,
    ] {
        // Array operand: even a would-be-true comparison is false.
        assert!(
            !eval_one(&scope, cond("list", "items", comparator, text_value("a"))),
            "{comparator:?} must reject an array operand"
        );
        // Array value against a scalar operand: same.
        assert!(
            !eval_one(
                &scope,
                cond("plain", "word", comparator, list_value(&["a"]))
            ),
            "{comparator:?} must reject an array value"
        );
    }
}

#[test]
fn unset_tokens_are_false_never_an_error() {
    let scope = scope_with(&[]);
    // Even is_not / is_empty — Node short-circuits a null operand to false.
    assert!(!eval_one(
        &scope,
        cond("ghost", "result", Comparator::IsNot, text_value("x"))
    ));
    assert!(!eval_one(
        &scope,
        cond("ghost", "result", Comparator::IsEmpty, None)
    ));
    assert!(!eval_one(
        &scope,
        cond("ghost", "result", Comparator::IsOneOf, list_value(&["x"]))
    ));
}

#[test]
fn all_and_any_match_modes() {
    let scope = scope_with(&[("f", "a", TokenValue::Text("yes".to_string()))]);
    let hit = || cond("f", "a", Comparator::Is, text_value("yes"));
    let miss = || cond("f", "a", Comparator::Is, text_value("no"));

    assert!(evaluate(&[hit(), hit()], ConditionMatch::All, &scope));
    assert!(!evaluate(&[hit(), miss()], ConditionMatch::All, &scope));
    assert!(evaluate(&[miss(), hit()], ConditionMatch::Any, &scope));
    assert!(!evaluate(&[miss(), miss()], ConditionMatch::Any, &scope));
    // Vacuous truth mirrors JS every()/some().
    assert!(evaluate(&[], ConditionMatch::All, &scope));
    assert!(!evaluate(&[], ConditionMatch::Any, &scope));
}
