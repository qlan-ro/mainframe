//! Phase 4a validation: `repeat`'s `concurrency` field, its interaction with
//! `break`, the nested fan-out cap, and the step-id charset the marker
//! scheme (`@c`, `@w`, `@a`) now depends on. Split out of `validate_tests.rs`
//! (300-line cap) as its own cohesive seam.

use serde_json::{Value, json};

use super::AutomationDefinition;
use super::validate::validate;

fn def(value: Value) -> AutomationDefinition {
    serde_json::from_value(value).unwrap()
}

fn list_prs() -> Value {
    json!({"id": "list-prs", "kind": "run_action", "actionId": "github.list_prs", "params": {}})
}

fn a_repeat(extra: Value) -> Value {
    let mut base = json!({
        "id": "rep", "kind": "repeat",
        "items": {"stepId": "list-prs", "output": "prs"},
        "steps": []
    });
    let map = base.as_object_mut().unwrap();
    for (k, v) in extra.as_object().unwrap() {
        map.insert(k.clone(), v.clone());
    }
    base
}

#[test]
fn a_break_inside_a_concurrent_repeat_is_rejected() {
    // A concurrency>1 repeat resets `in_loop` for its branches: breaking out
    // of one while its siblings are still in flight has no coherent target.
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [list_prs(), a_repeat(json!({
            "concurrency": 2,
            "steps": [{"id": "stop", "kind": "break"}]
        }))]
    })));
    assert!(
        errors.iter().any(|e| e.step_id.as_deref() == Some("stop")
            && e.message
                .contains("A break can't leave a concurrent repeat")),
        "expected the concurrent-branch-specific wording, got {errors:?}"
    );
}

#[test]
fn a_break_inside_a_non_concurrent_repeat_is_accepted() {
    for concurrency in [Value::Null, json!(1)] {
        let mut extra = json!({"steps": [{"id": "stop", "kind": "break"}]});
        if let Some(n) = concurrency.as_i64() {
            extra
                .as_object_mut()
                .unwrap()
                .insert("concurrency".to_string(), json!(n));
        }
        let errors = validate(&def(json!({
            "triggers": [],
            "steps": [list_prs(), a_repeat(extra)]
        })));
        assert!(
            errors.is_empty(),
            "concurrency {concurrency:?}: expected no errors, got {errors:?}"
        );
    }
}

#[test]
fn repeat_concurrency_out_of_range_is_rejected() {
    for concurrency in [0, 33] {
        let errors = validate(&def(json!({
            "triggers": [],
            "steps": [list_prs(), a_repeat(json!({"concurrency": concurrency}))]
        })));
        assert!(
            errors
                .iter()
                .any(|e| e.step_id.as_deref() == Some("rep")
                    && e.message.contains("between 1 and 32")),
            "concurrency {concurrency}: expected a range error, got {errors:?}"
        );
    }
}

#[test]
fn repeat_concurrency_at_the_bounds_is_clean() {
    for concurrency in [1, 32] {
        let errors = validate(&def(json!({
            "triggers": [],
            "steps": [list_prs(), a_repeat(json!({"concurrency": concurrency}))]
        })));
        assert_eq!(
            errors,
            vec![],
            "concurrency {concurrency}: expected no errors, got {errors:?}"
        );
    }
}

fn nested_concurrent_repeats(outer: u32, inner: u32) -> Value {
    json!({
        "triggers": [],
        "steps": [list_prs(), a_repeat(json!({
            "concurrency": outer,
            "steps": [{
                "id": "inner", "kind": "repeat",
                "items": {"stepId": "list-prs", "output": "prs"},
                "concurrency": inner,
                "steps": []
            }]
        }))]
    })
}

#[test]
fn nested_concurrency_over_the_product_cap_is_rejected() {
    let errors = validate(&def(nested_concurrent_repeats(32, 32)));
    assert!(
        errors.iter().any(|e| e.step_id.as_deref() == Some("inner")
            && e.message.contains("1024")
            && e.message
                .contains("nested inside another concurrent repeat")),
        "expected a nested-concurrency error naming the 1024-chat product, got {errors:?}"
    );
}

#[test]
fn nested_concurrency_at_or_under_the_product_cap_is_clean() {
    let errors = validate(&def(nested_concurrent_repeats(4, 4)));
    assert!(
        errors.is_empty(),
        "4x4 = 16 stays under the cap, expected no errors, got {errors:?}"
    );
}

#[test]
fn a_step_id_outside_the_charset_is_rejected() {
    for id in ["fanout@c", "a#b", "has space", "emoji🙂"] {
        let errors = validate(&def(json!({
            "triggers": [],
            "steps": [{"id": id, "kind": "notify", "message": ["ping"]}]
        })));
        assert!(
            errors
                .iter()
                .any(|e| e.step_id.as_deref() == Some(id) && e.message.contains("letters, numbers")),
            "id {id:?}: expected a charset error, got {errors:?}"
        );
    }
}

#[test]
fn a_step_id_using_only_the_allowed_charset_is_clean() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [{"id": "Step_1-ok", "kind": "notify", "message": ["ping"]}]
    })));
    assert!(errors.is_empty(), "expected no errors, got {errors:?}");
}
