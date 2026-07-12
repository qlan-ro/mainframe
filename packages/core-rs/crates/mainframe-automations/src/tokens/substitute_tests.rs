//! T3.1 — literal substitution (contract Decision 9): unset → '', numbers
//! without a spurious `.0`, lists newline-joined, records via `field`
//! dot-paths, builtins from the injected Clock.

use std::collections::BTreeMap;
use std::sync::Arc;

use chrono::{DateTime, FixedOffset};

use crate::domain::{ChipPart, TokenRef};
use crate::ports::Clock;

use super::scope::Scope;
use super::substitute::render;
use super::value::TokenValue;

struct FakeClock(DateTime<FixedOffset>);

impl Clock for FakeClock {
    fn now(&self) -> DateTime<FixedOffset> {
        self.0
    }
}

fn fixed_clock() -> Arc<dyn Clock> {
    // Local time 21:30 at UTC+2 on 2026-07-12 → 19:30 UTC.
    Arc::new(FakeClock(
        DateTime::parse_from_rfc3339("2026-07-12T21:30:00+02:00").unwrap(),
    ))
}

fn root() -> Scope<'static> {
    Scope::root(fixed_clock())
}

fn text(s: &str) -> ChipPart {
    ChipPart::Text(s.to_string())
}

fn token(step_id: &str, output: &str) -> ChipPart {
    ChipPart::Token {
        token: TokenRef {
            step_id: step_id.to_string(),
            output: output.to_string(),
            field: None,
        },
    }
}

fn token_field(step_id: &str, output: &str, field: &str) -> ChipPart {
    ChipPart::Token {
        token: TokenRef {
            step_id: step_id.to_string(),
            output: output.to_string(),
            field: Some(field.to_string()),
        },
    }
}

fn record(entries: &[(&str, TokenValue)]) -> TokenValue {
    TokenValue::Record(
        entries
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect::<BTreeMap<_, _>>(),
    )
}

#[test]
fn string_parts_splice_verbatim_around_tokens() {
    let mut scope = root();
    scope.bind("agent", "result", TokenValue::Text("ship it".to_string()));
    let parts = vec![text("Verdict: "), token("agent", "result"), text("!")];
    assert_eq!(render(&parts, &scope), "Verdict: ship it!");
}

#[test]
fn unset_token_renders_empty_string() {
    let scope = root();
    let parts = vec![text("["), token("ghost", "result"), text("]")];
    assert_eq!(render(&parts, &scope), "[]");
}

#[test]
fn integers_render_without_a_trailing_point_zero() {
    let mut scope = root();
    scope.bind("count", "exitCode", TokenValue::Number(5.0));
    scope.bind("ratio", "value", TokenValue::Number(2.5));
    assert_eq!(render(&[token("count", "exitCode")], &scope), "5");
    assert_eq!(render(&[token("ratio", "value")], &scope), "2.5");
}

#[test]
fn lists_join_with_newlines() {
    let mut scope = root();
    scope.bind(
        "cmd",
        "output",
        TokenValue::List(vec![
            TokenValue::Text("one".to_string()),
            TokenValue::Text("two".to_string()),
            TokenValue::Number(3.0),
        ]),
    );
    assert_eq!(render(&[token("cmd", "output")], &scope), "one\ntwo\n3");
}

#[test]
fn whole_records_render_as_json() {
    let mut scope = root();
    scope.bind(
        "hook",
        "payload",
        record(&[("action", TokenValue::Text("opened".to_string()))]),
    );
    assert_eq!(
        render(&[token("hook", "payload")], &scope),
        r#"{"action":"opened"}"#
    );
}

#[test]
fn current_item_field_dot_path_resolves() {
    // The plan's canonical example: {stepId:"current", output:"item", field:"url"}.
    let scope = root();
    let mut iteration = scope.child_iteration(record(&[(
        "url",
        TokenValue::Text("https://github.com/pr/1".to_string()),
    )]));
    iteration.bind("noop", "x", TokenValue::Text(String::new()));
    assert_eq!(
        render(&[token_field("current", "item", "url")], &iteration),
        "https://github.com/pr/1"
    );
}

#[test]
fn dot_paths_descend_records_and_list_indexes() {
    let mut scope = root();
    scope.bind(
        "gh",
        "prs",
        TokenValue::List(vec![record(&[(
            "author",
            record(&[("login", TokenValue::Text("doru".to_string()))]),
        )])]),
    );
    assert_eq!(
        render(&[token_field("gh", "prs", "0.author.login")], &scope),
        "doru"
    );
    // A miss anywhere along the path renders empty, never errors.
    assert_eq!(render(&[token_field("gh", "prs", "7.author")], &scope), "");
    assert_eq!(
        render(&[token_field("gh", "prs", "0.reviewer.login")], &scope),
        ""
    );
}

#[test]
fn builtins_come_from_the_injected_clock() {
    let scope = root();
    // `today` is the LOCAL date; `now` is the UTC instant, Node toISOString form.
    assert_eq!(render(&[token("builtin", "today")], &scope), "2026-07-12");
    assert_eq!(
        render(&[token("builtin", "now")], &scope),
        "2026-07-12T19:30:00.000Z"
    );
    assert_eq!(render(&[token("builtin", "tomorrow")], &scope), "");
}

#[test]
fn trigger_bindings_resolve_like_any_step() {
    let mut scope = root();
    scope.bind(
        "trigger",
        "payload",
        record(&[("action", TokenValue::Text("opened".to_string()))]),
    );
    assert_eq!(
        render(&[token_field("trigger", "payload", "action")], &scope),
        "opened"
    );
}

#[test]
fn repeat_iterations_are_isolated_from_the_parent_scope() {
    let mut scope = root();
    scope.bind("outer", "result", TokenValue::Text("visible".to_string()));

    {
        let mut iteration = scope.child_iteration(TokenValue::Text("item-a".to_string()));
        // Inner steps see outer bindings…
        assert_eq!(render(&[token("outer", "result")], &iteration), "visible");
        // …and the innermost `current`.
        assert_eq!(render(&[token("current", "item")], &iteration), "item-a");
        iteration.bind("inner", "result", TokenValue::Text("secret".to_string()));
        assert_eq!(render(&[token("inner", "result")], &iteration), "secret");

        // Nested Repeat: the inner current shadows the outer one.
        let nested = iteration.child_iteration(TokenValue::Text("item-b".to_string()));
        assert_eq!(render(&[token("current", "item")], &nested), "item-b");
        assert_eq!(render(&[token("outer", "result")], &nested), "visible");
    }

    // After the block, the iteration's bindings and `current` are gone.
    assert_eq!(render(&[token("inner", "result")], &scope), "");
    assert_eq!(render(&[token("current", "item")], &scope), "");
}
