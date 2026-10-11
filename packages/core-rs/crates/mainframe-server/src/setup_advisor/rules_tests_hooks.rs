//! Hooks rules: what earns the card, and what the card is allowed to claim.

use mainframe_types::setup_advisor::ProjectFingerprint;

use super::super::all;
use crate::setup_advisor::rule::Rule;

fn rule(id: &str) -> &'static Rule {
    all()
        .into_iter()
        .find(|rule| rule.id == id)
        .unwrap_or_else(|| panic!("no rule `{id}`"))
}

fn fires(id: &str, fp: &ProjectFingerprint) -> bool {
    rule(id).evaluate(fp).is_some()
}

/// The snippet dispatches to `vitest` and `pytest` by extension. A `tests/`
/// directory names neither, so it cannot be what earns the card — a Go project
/// with a `tests/` dir would be handed a hook that runs nothing.
#[test]
fn run_related_tests_needs_a_runner_the_snippet_can_actually_call() {
    let only_a_directory = ProjectFingerprint {
        dirs: vec!["tests".to_string()],
        ..Default::default()
    };

    assert!(!fires("hooks-run-related-tests", &only_a_directory));
}

#[test]
fn run_related_tests_fires_on_either_runner_the_snippet_dispatches_to() {
    for runner in ["vitest", "pytest"] {
        let fp = ProjectFingerprint {
            testing: vec![runner.to_string()],
            ..Default::default()
        };

        assert!(
            fires("hooks-run-related-tests", &fp),
            "expected the card on a {runner} project"
        );
    }
}

/// `jest` is a runner, but `npx vitest related` is not its command; recommending
/// this hook there would install a snippet that fails on every edit.
#[test]
fn run_related_tests_stays_silent_on_a_runner_the_snippet_cannot_drive() {
    let fp = ProjectFingerprint {
        testing: vec!["jest".to_string()],
        ..Default::default()
    };

    assert!(!fires("hooks-run-related-tests", &fp));
}

/// The matcher is `Edit|Write`, so `Bash(echo … >> .env)` walks straight past
/// this hook. The card has to name the door it actually locks.
#[test]
fn the_block_edits_card_scopes_its_claim_to_the_tools_it_matches() {
    let rule = rule("hooks-block-edits");
    let parsed: serde_json::Value = serde_json::from_str(rule.command).unwrap();
    let matcher = parsed["hooks"]["PreToolUse"][0]["matcher"]
        .as_str()
        .unwrap();

    assert_eq!(matcher, "Edit|Write");
    assert!(
        rule.why.contains("Edit") && rule.why.contains("Write"),
        "the copy claims more than the matcher covers: {:?}",
        rule.why
    );
}
