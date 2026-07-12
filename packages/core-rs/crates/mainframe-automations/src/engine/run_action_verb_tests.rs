//! run_action verb tests (T9.2): param rendering (joined string vs A1 script
//! parts), outputAs merging, and the missing-credential failure.

use std::sync::Arc;

use serde_json::json;

use crate::actions::{ActionRegistry, register_all_actions};
use crate::credentials::FileCredentialStore;
use crate::domain::{OutputAs, RunActionStep};
use crate::engine::run_action_verb::{RunActionVerb, build_action_input};
use crate::engine::test_support::{FakeClock, harness, text, token};
use crate::engine::{BoxFuture, StepOutcome, VerbContext};
use crate::ports::ProjectRegistry;
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
    let input = build_action_input(&step, &scope);
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
    let input = build_action_input(&cmd, &scope);
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
    let input = build_action_input(&cmd, &scope);
    assert_eq!(input["script"], json!([ { "chip": "" } ]));
}

#[test]
fn output_as_is_not_injected_into_other_actions() {
    let scope = Scope::root(Arc::new(FakeClock));
    let mut row = step("notion.add_row", vec![("Name", vec![text("v")])]);
    row.output_as = Some(OutputAs::Text);
    let input = build_action_input(&row, &scope);
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
