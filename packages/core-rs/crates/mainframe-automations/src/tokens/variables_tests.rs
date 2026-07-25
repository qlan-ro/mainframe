//! T6 — `$name` scanning and namespace derivation. The reference
//! implementation is packages/types/src/automation-domain/variables.ts; the
//! shared cases live in fixtures/automations/variable-substitution.json.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::Value;

use crate::domain::{AutomationDefinition, TokenRef};
use crate::engine::test_support::{
    FakeClock, ask_agent_step, notify_step, repeat_step, set_variable_step, text, token_ref,
};

use super::scope::Scope;
use super::substitute::render;
use super::value::TokenValue;
use super::variables::{
    NameMap, NameTarget, build_name_index, extract_variable_refs, sanitize_variable_name,
};

fn definition(steps: Vec<crate::domain::Step>) -> AutomationDefinition {
    AutomationDefinition {
        triggers: vec![],
        steps,
    }
}

fn target(names: &NameMap, name: &str) -> NameTarget {
    names
        .get(name)
        .unwrap_or_else(|| panic!("`${name}` must be in scope, got {:?}", names.keys()))
        .clone()
}

fn step_ref(step_id: &str, output: &str) -> NameTarget {
    NameTarget::Ref(token_ref(step_id, output, None))
}

#[test]
fn a_dollar_opens_a_ref_only_at_a_word_boundary() {
    assert!(
        extract_variable_refs("a$b and https://example.test/$repo").is_empty(),
        "mid-word `$` is literal text"
    );

    let input = "Ship $release_notes now";
    let refs = extract_variable_refs(input);
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].name, "release_notes");
    assert_eq!(&input[refs[0].start..refs[0].end], "$release_notes");
}

#[test]
fn a_trailing_period_is_text_not_part_of_the_path() {
    let refs = extract_variable_refs("Ship $release_notes.");
    assert_eq!(refs[0].path, Vec::<String>::new());
    assert_eq!(refs[0].end, 19, "the period is left for the text");
}

#[test]
fn a_path_digs_records_and_indexes_lists() {
    let refs = extract_variable_refs("See $trigger_payload.pull_request.title and $prs.0");
    assert_eq!(refs.len(), 2);
    assert_eq!(refs[0].name, "trigger_payload");
    assert_eq!(refs[0].path, ["pull_request", "title"]);
    assert_eq!(refs[1].name, "prs");
    assert_eq!(refs[1].path, ["0"], "a path segment may start with a digit");
}

#[test]
fn a_base_name_may_not_start_with_a_digit() {
    assert!(extract_variable_refs("cost $1abc").is_empty());
    assert!(extract_variable_refs("bare $ sign").is_empty());
}

#[test]
fn sanitize_folds_text_into_a_name_safe_identifier() {
    assert_eq!(sanitize_variable_name("Release Notes!"), "release_notes_");
    assert_eq!(sanitize_variable_name("prURL"), "pr_url");
    assert_eq!(sanitize_variable_name("mergedPRs"), "merged_prs");
    assert_eq!(sanitize_variable_name("chatId"), "chat_id");
    assert_eq!(sanitize_variable_name("2fast"), "_2fast");
    assert_eq!(sanitize_variable_name(""), "_");
}

#[test]
fn names_are_derived_per_producer_kind() {
    let definition = definition(vec![
        ask_agent_step("a1", false),
        set_variable_step("v1", "headline", vec![text("hi")]),
        notify_step("n", vec![text("$agent_result $headline")]),
    ]);

    let index = build_name_index(&definition);
    let names = &index["n"];

    assert_eq!(target(names, "agent_result"), step_ref("a1", "result"));
    assert_eq!(
        target(names, "agent_chat_id"),
        step_ref("a1", "chatId"),
        "implicit agent outputs take the step-kind prefix"
    );
    assert_eq!(target(names, "headline"), step_ref("v1", "value"));
    assert_eq!(target(names, "today"), step_ref("builtin", "today"));
}

#[test]
fn a_repeat_body_isolates_its_producers_from_later_siblings() {
    // The divergence case: a flat sweep would name the outer agent
    // `agent_result_2`, silently substituting the repeat body's value.
    let definition = definition(vec![
        repeat_step(
            "r",
            token_ref("a1", "result", None),
            vec![ask_agent_step("inner", false)],
        ),
        ask_agent_step("outer", false),
        notify_step("n", vec![text("$agent_result")]),
    ]);

    let index = build_name_index(&definition);
    let names = &index["n"];

    assert_eq!(target(names, "agent_result"), step_ref("outer", "result"));
    assert!(
        !names.contains_key("agent_result_2"),
        "the repeat body never leaks a second holder"
    );
    assert!(!names.contains_key("item"), "`$item` dies with the block");

    let inside = &index["inner"];
    assert_eq!(target(inside, "item"), NameTarget::CurrentItem);
}

#[test]
fn later_holders_of_a_derived_name_get_a_numeric_suffix() {
    let definition = definition(vec![
        ask_agent_step("a1", false),
        ask_agent_step("a2", false),
        notify_step("n", vec![text("$agent_result_2")]),
    ]);

    let names = &build_name_index(&definition)["n"];
    assert_eq!(target(names, "agent_result"), step_ref("a1", "result"));
    assert_eq!(target(names, "agent_result_2"), step_ref("a2", "result"));
}

#[test]
fn a_duplicate_set_variable_name_keeps_the_first_holder() {
    let definition = definition(vec![
        set_variable_step("v1", "headline", vec![text("first")]),
        set_variable_step("v2", "headline", vec![text("second")]),
        notify_step("n", vec![text("$headline")]),
    ]);

    let names = &build_name_index(&definition)["n"];
    assert_eq!(target(names, "headline"), step_ref("v1", "value"));
    assert!(
        !names.contains_key("headline_2"),
        "a name the user typed is never suffixed — validate reports the duplicate"
    );
}

/// Every case in the cross-language fixture, rendered through the real
/// `render` path: a synthetic step per scope entry, named by the fixture key.
#[test]
fn renders_every_shared_substitution_case() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../types/fixtures/automations/variable-substitution.json");
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("fixture {} must be readable: {e}", path.display()));
    let fixture: Value = serde_json::from_str(&raw).unwrap();
    let cases = fixture["cases"].as_array().unwrap();
    assert!(cases.len() >= 14, "the fixture must not silently shrink");

    for case in cases {
        let name = case["name"].as_str().unwrap();
        let mut scope = Scope::root(Arc::new(FakeClock));
        let mut names = NameMap::new();
        for (key, value) in case["scope"].as_object().unwrap() {
            if let Some(token_value) = TokenValue::from_json(value) {
                scope.bind(key, "value", token_value);
            }
            names.insert(
                key.clone(),
                NameTarget::Ref(TokenRef {
                    step_id: key.clone(),
                    output: "value".to_string(),
                    field: None,
                }),
            );
        }

        let parts = vec![crate::domain::ChipPart::Text(
            case["text"].as_str().unwrap().to_string(),
        )];
        assert_eq!(
            render(&parts, &scope, &names),
            case["expected"].as_str().unwrap(),
            "case: {name}"
        );
    }
}
