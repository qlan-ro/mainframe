//! Validation of named values (`set_variable` and `$name` refs), mirroring
//! packages/types/src/automation-domain/validate.ts message for message.

use serde_json::{Value, json};

use super::AutomationDefinition;
use super::validate::{ValidationLevel, validate};

fn def(value: Value) -> AutomationDefinition {
    serde_json::from_value(value).unwrap()
}

fn set_variable(id: &str, name: &str) -> Value {
    json!({"id": id, "kind": "set_variable", "name": name, "value": ["text"]})
}

fn messages_for(errors: &[super::ValidationError], step_id: &str) -> Vec<String> {
    errors
        .iter()
        .filter(|e| e.step_id.as_deref() == Some(step_id))
        .map(|e| e.message.clone())
        .collect()
}

#[test]
fn a_set_variable_step_needs_a_name() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [set_variable("v1", "  ")]
    })));
    assert_eq!(messages_for(&errors, "v1"), ["Give this value a name."]);
}

#[test]
fn a_set_variable_name_must_be_a_lowercase_identifier() {
    for name in ["Release Notes", "2nd", "notes-2", "Notes"] {
        let errors = validate(&def(json!({
            "triggers": [],
            "steps": [set_variable("v1", name)]
        })));
        assert_eq!(
            messages_for(&errors, "v1"),
            [
                "Use lowercase letters, numbers and underscores for a value name, starting with a letter."
            ],
            "expected {name} to be rejected"
        );
    }
}

#[test]
fn a_well_formed_set_variable_name_passes_and_its_value_lands_in_scope() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [
            set_variable("v1", "release_notes"),
            {"id": "n1", "kind": "notify", "message": [
                {"token": {"stepId": "v1", "output": "value"}}
            ]}
        ]
    })));
    assert_eq!(errors, vec![], "expected a clean definition");
}

#[test]
fn an_unresolved_name_is_reported_once_per_step() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [
            {"id": "n1", "kind": "notify", "message": ["$missing then $missing and $other"]}
        ]
    })));
    assert_eq!(
        messages_for(&errors, "n1"),
        [
            "This step uses $missing, but no earlier step defines it.",
            "This step uses $other, but no earlier step defines it."
        ]
    );
}

#[test]
fn a_name_an_earlier_step_defines_resolves() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [
            set_variable("v1", "release_notes"),
            {"id": "n1", "kind": "notify", "message": ["Ship $release_notes on $today"]}
        ]
    })));
    assert_eq!(errors, vec![], "builtins are in scope too");
}

#[test]
fn item_is_in_scope_only_inside_a_repeat_body() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [
            {"id": "v1", "kind": "set_variable", "name": "people", "value": ["a"]},
            {"id": "r1", "kind": "repeat", "items": {"stepId": "v1", "output": "value"},
             "steps": [{"id": "inner", "kind": "notify", "message": ["Hi $item"]}]},
            {"id": "after", "kind": "notify", "message": ["Bye $item"]}
        ]
    })));
    assert_eq!(messages_for(&errors, "inner"), Vec::<String>::new());
    assert_eq!(
        messages_for(&errors, "after"),
        ["This step uses $item, but no earlier step defines it."]
    );
}

/// `cd $HOME && pnpm build` is a legitimate prompt: the engine leaves an
/// unresolved name literal, so flagging it must not block the save.
#[test]
fn an_unresolved_name_is_a_warning_not_a_blocking_error() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [{"id": "n1", "kind": "notify", "message": ["cd $HOME && pnpm build"]}]
    })));
    assert_eq!(
        errors.iter().map(|e| e.level).collect::<Vec<_>>(),
        [ValidationLevel::Warning]
    );
}

#[test]
fn two_steps_sharing_a_name_are_both_flagged() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [set_variable("v1", "headline"), set_variable("v2", "headline")]
    })));
    let expected =
        ["Another value in this automation is already called $headline — rename one of them."];
    assert_eq!(messages_for(&errors, "v1"), expected);
    assert_eq!(
        messages_for(&errors, "v2"),
        expected,
        "neither step is the obvious one to rename, so both say so"
    );
}

/// M6: both arms leak into scope once the block closes, so the second holder
/// is unaddressable and every `$summary` written for it renders empty.
#[test]
fn two_if_arms_may_not_each_define_the_same_name() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [{
            "id": "if1", "kind": "if", "match": "all", "conditions": [],
            "then": [set_variable("v1", "summary")],
            "otherwise": [set_variable("v2", "summary")]
        }]
    })));
    assert_eq!(
        messages_for(&errors, "v1"),
        ["Another value in this automation is already called $summary — rename one of them."]
    );
    assert_eq!(messages_for(&errors, "v2").len(), 1);
}

#[test]
fn two_isolated_repeat_bodies_may_reuse_a_name() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [
            {"id": "list", "kind": "run_action", "actionId": "github.list_prs", "params": {}},
            {"id": "r1", "kind": "repeat", "items": {"stepId": "list", "output": "prs"},
             "steps": [set_variable("v1", "greeting")]},
            {"id": "r2", "kind": "repeat", "items": {"stepId": "list", "output": "prs"},
             "steps": [set_variable("v2", "greeting")]}
        ]
    })));
    assert_eq!(errors, vec![], "a repeat body is its own naming region");
}

#[test]
fn a_name_claimed_later_in_the_enclosing_region_still_clashes() {
    let errors = validate(&def(json!({
        "triggers": [],
        "steps": [
            set_variable("v0", "people"),
            {"id": "list", "kind": "run_action", "actionId": "github.list_prs", "params": {}},
            {"id": "r1", "kind": "repeat", "items": {"stepId": "list", "output": "prs"},
             "steps": [set_variable("inner", "people")]}
        ]
    })));
    assert_eq!(
        messages_for(&errors, "inner"),
        ["Another value in this automation is already called $people — rename one of them."],
        "an enclosing region's names reach into the body"
    );
}

// PORT STATUS: greenfield (docs/plans/2026-07-25-todo-234-automations-editor-plan.md T5/T6), not a TS port
// confidence: high
// todos: 0
// notes: messages mirror automation-domain/validate.ts; the namespace they
//        check against is tokens::variables::build_variable_namespace.
