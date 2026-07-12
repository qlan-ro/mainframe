//! T1.3 — plain-language validation: duplicate ids, forward refs, `current`
//! outside Repeat, comparator/type mismatches, block scoping, fixture cleanliness.

use serde_json::{Value, json};

use super::AutomationDefinition;
use super::validate::validate;

fn def(value: Value) -> AutomationDefinition {
    serde_json::from_value(value).unwrap()
}

fn notify(id: &str) -> Value {
    json!({"id": id, "kind": "notify", "message": ["ping"]})
}

#[test]
fn duplicate_step_ids_are_rejected() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [notify("dup"), notify("dup")]
    })));
    assert!(
        errors
            .iter()
            .any(|e| e.step_id.as_deref() == Some("dup") && e.message.contains("unique")),
        "expected a duplicate-id error, got {errors:?}"
    );
}

#[test]
fn empty_step_ids_are_rejected() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [notify("")]
    })));
    assert!(errors.iter().any(|e| e.message.contains("needs an id")));
}

#[test]
fn empty_definition_reports_an_automation_level_error() {
    let errors = validate(&def(json!({"triggers": [], "steps": []})));
    assert!(
        errors
            .iter()
            .any(|e| e.step_id.is_none() && e.message.contains("at least one step"))
    );
}

#[test]
fn forward_token_ref_says_it_comes_later() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [
            {"id": "notify-early", "kind": "notify", "message": [
                {"token": {"stepId": "form", "output": "mood"}}
            ]},
            {"id": "form", "kind": "ask_me", "title": "Check-in", "fields": [
                {"key": "mood", "type": "choice", "label": "Mood", "options": ["up", "down"]}
            ]}
        ]
    })));
    assert!(
        errors
            .iter()
            .any(|e| e.step_id.as_deref() == Some("notify-early")
                && e.message.contains("comes later")),
        "expected a comes-later error, got {errors:?}"
    );
}

#[test]
fn unknown_token_ref_says_the_value_no_longer_exists() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [
            {"id": "n", "kind": "notify", "message": [
                {"token": {"stepId": "ghost", "output": "result"}}
            ]}
        ]
    })));
    assert!(
        errors
            .iter()
            .any(|e| e.step_id.as_deref() == Some("n") && e.message.contains("no longer exists"))
    );
}

#[test]
fn current_outside_a_repeat_block_is_rejected() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [
            {"id": "n", "kind": "notify", "message": [
                {"token": {"stepId": "current", "output": "item"}}
            ]}
        ]
    })));
    assert!(
        errors
            .iter()
            .any(|e| e.step_id.as_deref() == Some("n") && e.message.contains("Repeat")),
        "expected a current-outside-Repeat error, got {errors:?}"
    );
}

#[test]
fn comparator_must_fit_the_token_type() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [
            {"id": "list-prs", "kind": "run_action", "actionId": "github.list_prs", "params": {}},
            {"id": "gate", "kind": "if", "match": "all", "conditions": [
                {"token": {"stepId": "list-prs", "output": "prs"}, "comparator": "starts_with", "value": "x"}
            ], "then": [], "otherwise": []}
        ]
    })));
    assert!(
        errors
            .iter()
            .any(|e| e.step_id.as_deref() == Some("gate") && e.message.contains("starts_with")),
        "expected a comparator-mismatch error, got {errors:?}"
    );

    let clean = validate(&def(json!({
        "triggers": [],
        "steps": [
            {"id": "list-prs", "kind": "run_action", "actionId": "github.list_prs", "params": {}},
            {"id": "gate", "kind": "if", "match": "all", "conditions": [
                {"token": {"stepId": "list-prs", "output": "prs"}, "comparator": "not_empty"}
            ], "then": [], "otherwise": []}
        ]
    })));
    assert_eq!(clean, vec![], "not_empty fits a list token");
}

#[test]
fn repeat_items_must_reference_a_list_token() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [
            {"id": "agent", "kind": "ask_agent", "prompt": ["go"]},
            {"id": "rep", "kind": "repeat", "items": {"stepId": "agent", "output": "result"},
             "steps": [notify("inner")]}
        ]
    })));
    assert!(
        errors
            .iter()
            .any(|e| e.step_id.as_deref() == Some("rep") && e.message.contains("isn't a list"))
    );
}

#[test]
fn repeat_body_outputs_are_invisible_after_the_block() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [
            {"id": "list-prs", "kind": "run_action", "actionId": "github.list_prs", "params": {}},
            {"id": "rep", "kind": "repeat", "items": {"stepId": "list-prs", "output": "prs"}, "steps": [
                {"id": "inner-agent", "kind": "ask_agent", "prompt": [
                    {"token": {"stepId": "current", "output": "item", "field": "url"}}
                ]}
            ]},
            {"id": "after", "kind": "notify", "message": [
                {"token": {"stepId": "inner-agent", "output": "result"}}
            ]}
        ]
    })));
    assert!(
        errors
            .iter()
            .any(|e| e.step_id.as_deref() == Some("after")
                && e.message.contains("isn't available here")),
        "expected an isolation error, got {errors:?}"
    );
}

#[test]
fn if_branch_outputs_are_visible_to_later_outer_siblings() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [
            {"id": "form", "kind": "ask_me", "title": "Pick", "fields": [
                {"key": "go", "type": "choice", "label": "Go", "options": ["yes", "no"]}
            ]},
            {"id": "gate", "kind": "if", "match": "all", "conditions": [
                {"token": {"stepId": "form", "output": "go"}, "comparator": "is", "value": "yes"}
            ], "then": [
                {"id": "branch-agent", "kind": "ask_agent", "prompt": ["do it"]}
            ], "otherwise": []},
            {"id": "after", "kind": "notify", "message": [
                {"token": {"stepId": "branch-agent", "output": "result"}}
            ]}
        ]
    })));
    assert_eq!(
        errors,
        vec![],
        "taken-branch outputs leak after the block closes"
    );
}

#[test]
fn three_way_if_nested_in_otherwise_is_accepted() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [
            {"id": "form", "kind": "ask_me", "title": "Route", "fields": [
                {"key": "action", "type": "choice", "label": "Action", "options": ["a", "b", "c"], "required": true}
            ]},
            {"id": "if-a", "kind": "if", "match": "all", "conditions": [
                {"token": {"stepId": "form", "output": "action"}, "comparator": "is", "value": "a"}
            ], "then": [notify("n-a")], "otherwise": [
                {"id": "if-b", "kind": "if", "match": "all", "conditions": [
                    {"token": {"stepId": "form", "output": "action"}, "comparator": "is", "value": "b"}
                ], "then": [notify("n-b")], "otherwise": [notify("n-c")]}
            ]}
        ]
    })));
    assert_eq!(errors, vec![]);
}

#[test]
fn form_fields_need_labels_and_choice_options() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [
            {"id": "form", "kind": "ask_me", "title": "Bad form", "fields": [
                {"key": "", "type": "text"},
                {"key": "pick", "type": "choice", "label": "Pick"}
            ]}
        ]
    })));
    assert!(errors.iter().any(|e| e.message.contains("needs a label")));
    assert!(errors.iter().any(|e| e.message.contains("no options")));
}

#[test]
fn run_action_needs_an_action_id() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [{"id": "act", "kind": "run_action", "actionId": "", "params": {}}]
    })));
    assert!(
        errors
            .iter()
            .any(|e| e.message.contains("Choose an action"))
    );
}

#[test]
fn all_six_fixtures_validate_clean() {
    for name in super::fixture_tests::FIXTURES {
        let (_, parsed) = super::fixture_tests::load_fixture(name);
        let errors = validate(&parsed.definition);
        assert_eq!(errors, vec![], "fixture {name} must produce zero errors");
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T1.3), not a TS port
// confidence: high
// todos: 0
// notes: message texts mirror Node's plain-language validate (packages/types/src/automation-domain/validate.ts).
