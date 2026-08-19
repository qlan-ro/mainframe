//! run_action verb tests (T9.2): param rendering (joined string vs A1 script
//! parts), outputAs merging, and the missing-credential failure.

use std::sync::Arc;

use serde_json::json;

use crate::actions::{ActionRegistry, register_all_actions};
use crate::credentials::{CredentialKind, CredentialStore, Credentials, FileCredentialStore};
use crate::domain::{OutputAs, RunActionStep};
use crate::engine::run_action_verb::{RunActionVerb, build_action_input};
use crate::engine::test_support::{FakeClock, harness, text, token};
use crate::engine::{BoxFuture, StepOutcome, VerbContext};
use crate::ports::ProjectRegistry;
use crate::tokens::NameMap;
use crate::tokens::{Scope, TokenValue};

struct FixedProjects(String);

impl ProjectRegistry for FixedProjects {
    fn resolve_project_root<'a>(&'a self, _project_id: Option<&'a str>) -> BoxFuture<'a, String> {
        Box::pin(async move { self.0.clone() })
    }
}

fn step(action_id: &str, params: Vec<(&str, Vec<crate::domain::ChipPart>)>) -> RunActionStep {
    RunActionStep {
        id: "act".to_string(),
        keep_going: false,
        action_id: action_id.to_string(),
        credential: None,
        params: params
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect(),
        output_as: None,
        output_name: None,
    }
}

fn scope_with(step_id: &str, output: &str, value: TokenValue) -> Scope<'static> {
    let mut scope = Scope::root(Arc::new(FakeClock));
    scope.bind(step_id, output, value);
    scope
}

#[test]
fn params_render_to_one_joined_string() {
    let scope = scope_with("s1", "out", TokenValue::Text("X".to_string()));
    let step = step(
        "files.append",
        vec![
            ("path", vec![text("/tmp/f")]),
            ("content", vec![text("a "), token("s1", "out", None)]),
        ],
    );
    let input = build_action_input(&step, &scope, &NameMap::new());
    assert_eq!(input, json!({ "path": "/tmp/f", "content": "a X" }));
}

#[test]
fn run_command_script_keeps_chip_boundaries() {
    let scope = scope_with("s1", "out", TokenValue::Text("; rm -rf /".to_string()));
    let mut cmd = step(
        "run_command",
        vec![
            ("script", vec![text("echo "), token("s1", "out", None)]),
            ("runIn", vec![text("project root")]),
        ],
    );
    cmd.output_as = Some(OutputAs::Lines);
    let input = build_action_input(&cmd, &scope, &NameMap::new());
    assert_eq!(
        input,
        json!({
            "script": [ { "literal": "echo " }, { "chip": "; rm -rf /" } ],
            "runIn": "project root",
            "outputAs": "lines"
        })
    );
}

#[test]
fn unset_script_chip_renders_empty() {
    let scope = Scope::root(Arc::new(FakeClock));
    let cmd = step(
        "run_command",
        vec![("script", vec![token("ghost", "out", None)])],
    );
    let input = build_action_input(&cmd, &scope, &NameMap::new());
    assert_eq!(input["script"], json!([ { "chip": "" } ]));
}

#[test]
fn output_as_is_not_injected_into_other_actions() {
    let scope = Scope::root(Arc::new(FakeClock));
    let mut row = step("notion.add_row", vec![("Name", vec![text("v")])]);
    row.output_as = Some(OutputAs::Text);
    let input = build_action_input(&row, &scope, &NameMap::new());
    assert_eq!(input, json!({ "Name": "v" }));
}

#[tokio::test]
async fn missing_credential_fails_with_an_actionable_error() {
    let h = harness().await;
    let dir = tempfile::tempdir().unwrap();
    let mut registry = ActionRegistry::new();
    register_all_actions(&mut registry).unwrap();
    let credentials = Arc::new(FileCredentialStore::load(dir.path().join("creds.json")).await);
    let automations = crate::store::AutomationStore::new(h.db.clone());
    let verb = RunActionVerb::new(
        Arc::new(registry),
        credentials,
        Arc::new(FixedProjects(dir.path().to_string_lossy().into_owned())),
        h.store.clone(),
        automations,
    );

    let mut pr = step("github.create_pr", vec![]);
    pr.credential = Some("gh".to_string());
    let scope = Scope::root(Arc::new(FakeClock));
    let outcome = verb
        .execute(
            &pr,
            VerbContext {
                run_id: "r1",
                step_ref: "act",
                scope: &scope,
                names: &NameMap::new(),
            },
        )
        .await;
    match outcome {
        StepOutcome::Failed { error } => {
            assert_eq!(
                error,
                "credential 'gh' not found — add it via PUT /api/automation-credentials/gh"
            );
        }
        other => panic!("expected failure, got {other:?}"),
    }
}

/// A fake action carrying the real `github.list_prs` manifest's auth shape
/// (`auth: token`, hint `github`) but no HTTP call, so the default-label
/// test below stays hermetic.
struct FakeGithubListPrs;

impl crate::actions::Action for FakeGithubListPrs {
    fn manifest(&self) -> crate::actions::ActionManifest {
        crate::actions::ActionManifest {
            id: "github.list_prs",
            title: "fake",
            group: crate::actions::ActionGroup::Connector,
            auth: crate::actions::ActionAuth::Token,
            credential_label_hint: Some("github"),
            params_schema: json!({"type": "object"}),
            fields: vec![],
            has_output_as: false,
            outputs: vec![],
            idempotent: true,
        }
    }

    fn execute<'a>(
        &'a self,
        _params: &'a serde_json::Value,
        _ctx: &'a crate::actions::ActionCtx,
    ) -> BoxFuture<'a, Result<crate::actions::ActionOutputs, crate::actions::ActionError>> {
        Box::pin(async move { Ok(std::collections::BTreeMap::new()) })
    }
}

/// A GitHub step saved before the REST migration carries no `credential`
/// label (the old manifest declared `auth: none`). It must resolve against
/// the well-known `github` label rather than failing or running
/// unauthenticated.
#[tokio::test]
async fn a_pre_migration_github_step_resolves_the_default_credential_label() {
    let h = harness().await;
    let dir = tempfile::tempdir().unwrap();
    let mut registry = ActionRegistry::new();
    registry.register(Box::new(FakeGithubListPrs)).unwrap();
    let credentials = Arc::new(FileCredentialStore::load(dir.path().join("creds.json")).await);
    credentials
        .set(
            "github",
            Credentials {
                kind: CredentialKind::Token,
                token: "ghp_migrated".to_string(),
                extra: None,
            },
        )
        .await
        .unwrap();
    let automations = crate::store::AutomationStore::new(h.db.clone());
    let verb = RunActionVerb::new(
        Arc::new(registry),
        credentials,
        Arc::new(FixedProjects(dir.path().to_string_lossy().into_owned())),
        h.store.clone(),
        automations,
    );

    // A step exactly as an old, pre-migration definition would carry it:
    // `action_id` set, `credential` absent.
    let list_prs = step("github.list_prs", vec![]);
    let scope = Scope::root(Arc::new(FakeClock));
    let outcome = verb
        .execute(
            &list_prs,
            VerbContext {
                run_id: "r1",
                step_ref: "act",
                scope: &scope,
                names: &NameMap::new(),
            },
        )
        .await;

    assert!(
        matches!(outcome, StepOutcome::Completed { .. }),
        "expected success (the default label must resolve), got {outcome:?}"
    );
}

/// The same pre-migration step, but nobody has connected GitHub yet: the
/// failure must name the defaulted `github` label specifically, proving the
/// fallback actually chose it rather than skipping credential resolution.
#[tokio::test]
async fn a_pre_migration_github_step_with_no_connection_names_the_default_label() {
    let h = harness().await;
    let dir = tempfile::tempdir().unwrap();
    let mut registry = ActionRegistry::new();
    registry.register(Box::new(FakeGithubListPrs)).unwrap();
    let credentials = Arc::new(FileCredentialStore::load(dir.path().join("creds.json")).await);
    let automations = crate::store::AutomationStore::new(h.db.clone());
    let verb = RunActionVerb::new(
        Arc::new(registry),
        credentials,
        Arc::new(FixedProjects(dir.path().to_string_lossy().into_owned())),
        h.store.clone(),
        automations,
    );

    let list_prs = step("github.list_prs", vec![]);
    let scope = Scope::root(Arc::new(FakeClock));
    let outcome = verb
        .execute(
            &list_prs,
            VerbContext {
                run_id: "r1",
                step_ref: "act",
                scope: &scope,
                names: &NameMap::new(),
            },
        )
        .await;

    match outcome {
        StepOutcome::Failed { error } => {
            assert_eq!(
                error,
                "credential 'github' not found — add it via PUT /api/automation-credentials/github"
            );
        }
        other => panic!("expected failure, got {other:?}"),
    }
}
