//! T7.1 — github connector over a stub `gh`: create_pr → `{prUrl, prNumber}`,
//! list_prs → `{prs: List<Record{url,title,number,author}>}` (contract §5
//! camelCase), and catalog entries that mute themselves when the CLI can't be
//! used. Auth is gone from these tests on purpose: `gh` holds the token, so
//! the actions take no credential.

use std::collections::BTreeMap;

use serde_json::{Value, json};

use crate::tokens::TokenValue;

use super::gh_stub::{StubGh, missing_gh};
use super::github::{GithubCreatePrAction, GithubListPrsAction};
use super::manifest::{ActionAuth, ActionOutput, ActionOutputType};
use super::{Action, ActionCtx, ActionRegistry};

fn ctx() -> ActionCtx {
    ActionCtx {
        creds: None,
        credential_label: None,
        idempotency_key: "run-1:step-1".to_string(),
        project_root: "/tmp".to_string(),
        worktree_path: None,
    }
}

fn sent_body(stub: &StubGh) -> Value {
    serde_json::from_str(&stub.stdin()).unwrap()
}

#[tokio::test]
async fn create_pr_posts_the_body_and_maps_outputs() {
    let stub =
        StubGh::ready(r#"{"html_url": "https://github.com/qlan/mainframe/pull/7", "number": 7}"#);

    let outputs = GithubCreatePrAction::new(stub.cli())
        .execute(
            &json!({
                "repo": "qlan/mainframe",
                "title": "feat: thing",
                "body": "does the thing",
                "head": "feat/thing",
                "base": "main",
            }),
            &ctx(),
        )
        .await
        .unwrap();

    // One spawn: running an action never re-probes availability.
    assert_eq!(
        stub.calls(),
        ["api repos/qlan/mainframe/pulls --method POST --input -"]
    );
    assert_eq!(
        sent_body(&stub),
        json!({
            "title": "feat: thing",
            "body": "does the thing",
            "head": "feat/thing",
            "base": "main",
        })
    );
    assert_eq!(
        outputs["prUrl"],
        TokenValue::Text("https://github.com/qlan/mainframe/pull/7".to_string())
    );
    assert_eq!(outputs["prNumber"], TokenValue::Number(7.0));
    assert_eq!(
        outputs.keys().collect::<Vec<_>>(),
        vec!["prNumber", "prUrl"]
    );
}

#[tokio::test]
async fn create_pr_body_defaults_to_empty() {
    let stub = StubGh::ready(r#"{"html_url": "https://github.com/o/r/pull/1", "number": 1}"#);

    GithubCreatePrAction::new(stub.cli())
        .execute(
            &json!({"repo": "o/r", "title": "t", "head": "h", "base": "b"}),
            &ctx(),
        )
        .await
        .unwrap();

    assert_eq!(
        sent_body(&stub),
        json!({"title": "t", "body": "", "head": "h", "base": "b"})
    );
}

#[tokio::test]
async fn list_prs_searches_and_maps_records() {
    let stub = StubGh::ready(
        r#"[
            {"url": "https://github.com/o/r/pull/1", "title": "one", "number": 1, "author": {"login": "doru"}},
            {"url": "https://github.com/o/r/pull/2", "title": "two", "number": 2, "author": {"login": "doru"}}
        ]"#,
    );

    let outputs = GithubListPrsAction::new(stub.cli())
        .execute(&json!({}), &ctx())
        .await
        .unwrap();

    // `gh search prs` resolves `@me` itself — the REST search endpoint the
    // old HTTP client called never did.
    assert_eq!(
        stub.calls(),
        ["search prs --state open --author @me --json url,title,number,author"]
    );
    let expected_first = TokenValue::Record(BTreeMap::from([
        (
            "url".to_string(),
            TokenValue::Text("https://github.com/o/r/pull/1".to_string()),
        ),
        ("title".to_string(), TokenValue::Text("one".to_string())),
        ("number".to_string(), TokenValue::Number(1.0)),
        ("author".to_string(), TokenValue::Text("doru".to_string())),
    ]));
    match &outputs["prs"] {
        TokenValue::List(items) => {
            assert_eq!(items.len(), 2);
            assert_eq!(items[0], expected_first);
        }
        other => panic!("prs is not a list: {other:?}"),
    }
}

#[tokio::test]
async fn a_repo_that_could_reshape_the_endpoint_never_reaches_gh() {
    let stub = StubGh::ready("");

    let err = GithubCreatePrAction::new(stub.cli())
        .execute(
            &json!({"repo": "o/r/pulls/1", "title": "t", "head": "h", "base": "b"}),
            &ctx(),
        )
        .await
        .unwrap_err();

    assert!(err.0.contains("must be 'owner/name'"), "{}", err.0);
    assert!(stub.calls().is_empty(), "{:?}", stub.calls());
}

#[tokio::test]
async fn strict_inputs_reject_unknown_and_missing_fields() {
    let action = GithubCreatePrAction::new(missing_gh());

    let err = action
        .execute(&json!({"repo": "o/r"}), &ctx())
        .await
        .unwrap_err();
    assert!(
        err.0.contains("invalid input for 'github.create_pr'"),
        "{}",
        err.0
    );

    let err = action
        .execute(
            &json!({"repo": "o/r", "title": "t", "head": "h", "base": "b", "extra": 1}),
            &ctx(),
        )
        .await
        .unwrap_err();
    assert!(
        err.0.contains("invalid input for 'github.create_pr'"),
        "{}",
        err.0
    );
}

#[tokio::test]
async fn the_catalog_mutes_the_actions_when_gh_is_unusable() {
    let logged_out = StubGh::logged_out();
    let mut registry = ActionRegistry::new();
    registry
        .register(Box::new(GithubCreatePrAction::new(missing_gh())))
        .unwrap();
    registry
        .register(Box::new(GithubListPrsAction::new(logged_out.cli())))
        .unwrap();

    let catalog = registry.wire_catalog().await;

    assert!(!catalog[0].available);
    assert_eq!(
        catalog[0].unavailable_reason.as_deref(),
        Some(
            "The GitHub CLI isn't installed. Install the GitHub CLI from https://cli.github.com, then run `gh auth login`."
        )
    );
    assert!(!catalog[1].available);
    assert_eq!(
        catalog[1].unavailable_reason.as_deref(),
        Some("The GitHub CLI isn't signed in. Run `gh auth login`.")
    );
}

#[tokio::test]
async fn a_signed_in_cli_leaves_the_actions_usable() {
    let stub = StubGh::ready("");
    let mut registry = ActionRegistry::new();
    registry
        .register(Box::new(GithubListPrsAction::new(stub.cli())))
        .unwrap();

    let catalog = registry.wire_catalog().await;

    assert!(catalog[0].available);
    assert_eq!(catalog[0].unavailable_reason, None);
}

#[test]
fn manifests_match_contract() {
    let create = GithubCreatePrAction::new(missing_gh()).manifest();
    assert_eq!(create.id, "github.create_pr");
    assert_eq!(
        create.outputs,
        vec![
            ActionOutput::new("prUrl", ActionOutputType::Text),
            ActionOutput::new("prNumber", ActionOutputType::Number),
        ]
    );
    assert!(!create.idempotent);
    // The CLI owns the token, so neither action asks for a credential.
    assert_eq!(create.auth, ActionAuth::None);
    assert_eq!(create.credential_label_hint, None);

    let list = GithubListPrsAction::new(missing_gh()).manifest();
    assert_eq!(list.id, "github.list_prs");
    assert_eq!(
        list.outputs,
        vec![ActionOutput::new("prs", ActionOutputType::List)]
    );
    assert!(list.idempotent);
    assert_eq!(list.auth, ActionAuth::None);
    assert_eq!(list.credential_label_hint, None);
}
