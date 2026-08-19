//! Phase 4b validation: `parallel`'s branch-count bounds, its interaction
//! with `break`, and the nested fan-out cap counting a `parallel`'s branch
//! count the same way it already counts a concurrent repeat's factor. Split
//! out as its own seam, mirroring `validate_concurrency_tests.rs` (Phase 4a).

use serde_json::{Value, json};

use super::AutomationDefinition;
use super::validate::validate;

fn def(value: Value) -> AutomationDefinition {
    serde_json::from_value(value).unwrap()
}

fn leaf(id: &str) -> Value {
    json!({"id": id, "kind": "notify", "message": ["ping"]})
}

fn parallel(id: &str, branches: Vec<Value>) -> Value {
    json!({"id": id, "kind": "parallel", "branches": branches})
}

fn n_leaf_branches(n: u32, prefix: &str) -> Vec<Value> {
    (0..n)
        .map(|i| json!([leaf(&format!("{prefix}{i}"))]))
        .collect()
}

#[test]
fn a_parallel_needs_at_least_two_branches() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [parallel("split", vec![json!([leaf("a")])])]
    })));
    assert!(
        errors
            .iter()
            .any(|e| e.step_id.as_deref() == Some("split")
                && e.message.contains("at least 2 branches")),
        "expected the branch-count error, got {errors:?}"
    );
}

#[test]
fn a_single_branch_holding_an_if_with_no_otherwise_still_needs_a_second_branch() {
    // The `if`'s empty `otherwise` is valid on its own — this pins that the
    // branch-count error still fires and isn't masked or confused by it.
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [parallel("split", vec![json!([{
            "id": "cond", "kind": "if", "match": "all", "conditions": [],
            "then": [leaf("only")], "otherwise": []
        }])])]
    })));
    assert!(
        errors
            .iter()
            .any(|e| e.step_id.as_deref() == Some("split")
                && e.message.contains("at least 2 branches")),
        "expected the branch-count error, got {errors:?}"
    );
}

#[test]
fn a_parallel_over_the_branch_cap_is_rejected() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [parallel("split", n_leaf_branches(33, "b"))]
    })));
    assert!(
        errors
            .iter()
            .any(|e| e.step_id.as_deref() == Some("split")
                && e.message.contains("at most 32 branches")),
        "expected the branch-cap error, got {errors:?}"
    );
}

#[test]
fn a_parallel_branch_count_at_the_bounds_is_clean() {
    for n in [2, 32] {
        let errors = validate(&def(json!({
            "triggers": [],
            "steps": [parallel("split", n_leaf_branches(n, "b"))]
        })));
        assert_eq!(
            errors,
            vec![],
            "{n} branches: expected no errors, got {errors:?}"
        );
    }
}

#[test]
fn a_break_inside_a_parallel_branch_is_rejected_with_the_concurrent_branch_wording() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [parallel("split", vec![
            json!([{"id": "stop", "kind": "break"}]),
            json!([leaf("b")]),
        ])]
    })));
    assert!(
        errors.iter().any(|e| e.step_id.as_deref() == Some("stop")
            && e.message
                .contains("A break can't leave a concurrent repeat")),
        "expected the concurrent-branch-specific wording, got {errors:?}"
    );
}

fn nested_parallel(outer: u32, inner: u32) -> Value {
    let mut branches = n_leaf_branches(outer, "o");
    branches[0] = json!([parallel("inner", n_leaf_branches(inner, "i"))]);
    json!({
        "triggers": [],
        "steps": [parallel("outer", branches)]
    })
}

#[test]
fn nested_parallel_over_the_product_cap_is_rejected() {
    let errors = validate(&def(nested_parallel(32, 32)));
    assert!(
        errors.iter().any(|e| e.step_id.as_deref() == Some("inner")
            && e.message.contains("1024")
            && e.message
                .contains("nested inside another concurrent repeat or parallel block")),
        "expected a nested-concurrency error naming the 1024-chat product, got {errors:?}"
    );
}

#[test]
fn nested_parallel_at_or_under_the_product_cap_is_clean() {
    let errors = validate(&def(nested_parallel(4, 4)));
    assert!(
        errors.is_empty(),
        "4x4 = 16 stays under the cap, expected no errors, got {errors:?}"
    );
}

#[test]
fn a_parallel_nested_inside_a_concurrent_repeat_counts_toward_the_same_product_cap() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [
            {"id": "list-prs", "kind": "run_action", "actionId": "github.list_prs", "params": {}},
            {
                "id": "rep", "kind": "repeat",
                "items": {"stepId": "list-prs", "output": "prs"},
                "concurrency": 32,
                "steps": [parallel("split", n_leaf_branches(32, "b"))]
            }
        ]
    })));
    assert!(
        errors
            .iter()
            .any(|e| e.step_id.as_deref() == Some("split") && e.message.contains("1024")),
        "a parallel's branch count must multiply into an enclosing concurrent repeat's own \
         factor, got {errors:?}"
    );
}
