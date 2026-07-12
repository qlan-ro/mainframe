//! Facade tests (T9.2): construction over a tempfile DB with fake ports,
//! CRUD + validation, manual runs, and A8 delete-cancels-active-runs.

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use tempfile::TempDir;

use crate::domain::{
    AskMeStep, AutomationCreateInput, AutomationFormField, AutomationScope, FormFieldType, Step,
};
use crate::engine::BoxFuture;
use crate::engine::test_support::{
    CollectingSink, FakeClock, ask_agent_step, definition, notify_step, text,
};
use crate::error::StoreError;
use crate::ports::{
    AgentHandle, AgentOutcome, AgentPort, AgentPortError, AgentRequest, Notification, Notifier,
    NotifyError, ProjectRegistry,
};
use crate::store::RunStatus;

use super::start::StartError;
use super::{AutomationsConfig, AutomationsEngine, AutomationsPorts, EngineError};

struct NoAgent;

impl AgentPort for NoAgent {
    fn start(&self, _request: AgentRequest) -> BoxFuture<'_, Result<AgentHandle, AgentPortError>> {
        Box::pin(async { Err(AgentPortError("no agent in this test".to_string())) })
    }
    fn watch<'a>(
        &'a self,
        _chat_id: &'a str,
    ) -> BoxFuture<'a, Result<AgentOutcome, AgentPortError>> {
        Box::pin(async { Err(AgentPortError("no agent in this test".to_string())) })
    }
    fn retry<'a>(
        &'a self,
        _chat_id: &'a str,
        _correction: &'a str,
    ) -> BoxFuture<'a, Result<AgentOutcome, AgentPortError>> {
        Box::pin(async { Err(AgentPortError("no agent in this test".to_string())) })
    }
    fn cancel<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, Result<(), AgentPortError>> {
        Box::pin(async { Ok(()) })
    }
}

struct OkNotifier;

impl Notifier for OkNotifier {
    fn notify(&self, _notification: Notification) -> BoxFuture<'_, Result<(), NotifyError>> {
        Box::pin(async { Ok(()) })
    }
}

struct FixedProjects(String);

impl ProjectRegistry for FixedProjects {
    fn resolve_project_root<'a>(&'a self, _project_id: Option<&'a str>) -> BoxFuture<'a, String> {
        Box::pin(async move { self.0.clone() })
    }
}

async fn engine() -> (Arc<AutomationsEngine>, Arc<CollectingSink>, TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let sink = Arc::new(CollectingSink::default());
    let engine = AutomationsEngine::new(
        AutomationsConfig {
            db_path: dir.path().join("automations.db"),
            credentials_path: dir.path().join("automation-credentials.json"),
        },
        AutomationsPorts {
            agent: Arc::new(NoAgent),
            notifier: Arc::new(OkNotifier),
            events: sink.clone(),
            projects: Arc::new(FixedProjects(dir.path().to_string_lossy().into_owned())),
            clock: Arc::new(FakeClock),
            event_source: None,
            registry: None,
        },
    )
    .await
    .unwrap();
    (engine, sink, dir)
}

/// Builds an engine over an explicit db/credentials path so a second engine
/// can reconcile the SAME store after the first is dropped (restart parity).
async fn build_engine(
    db_path: &Path,
    credentials_path: &Path,
    agent: Arc<dyn AgentPort>,
    sink: Arc<CollectingSink>,
) -> Arc<AutomationsEngine> {
    AutomationsEngine::new(
        AutomationsConfig {
            db_path: db_path.to_path_buf(),
            credentials_path: credentials_path.to_path_buf(),
        },
        AutomationsPorts {
            agent,
            notifier: Arc::new(OkNotifier),
            events: sink,
            projects: Arc::new(FixedProjects(".".to_string())),
            clock: Arc::new(FakeClock),
            event_source: None,
            registry: None,
        },
    )
    .await
    .unwrap()
}

/// Parks an ask_agent step forever: the chat starts, but `watch` never
/// resolves, so the run stays `waiting` until a fresh engine adopts it.
struct ParkingAgent;

impl AgentPort for ParkingAgent {
    fn start(&self, _request: AgentRequest) -> BoxFuture<'_, Result<AgentHandle, AgentPortError>> {
        Box::pin(async {
            Ok(AgentHandle {
                chat_id: "chat-parked".to_string(),
            })
        })
    }
    fn watch<'a>(
        &'a self,
        _chat_id: &'a str,
    ) -> BoxFuture<'a, Result<AgentOutcome, AgentPortError>> {
        Box::pin(std::future::pending())
    }
    fn retry<'a>(
        &'a self,
        _chat_id: &'a str,
        _correction: &'a str,
    ) -> BoxFuture<'a, Result<AgentOutcome, AgentPortError>> {
        Box::pin(std::future::pending())
    }
    fn cancel<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, Result<(), AgentPortError>> {
        Box::pin(async { Ok(()) })
    }
}

/// Adopts an already-started chat: `watch` completes immediately, and `start`
/// panics — reconcile must re-attach the existing chat, never open a new one.
#[derive(Default)]
struct AdoptingAgent {
    start_calls: AtomicUsize,
}

impl AgentPort for AdoptingAgent {
    fn start(&self, _request: AgentRequest) -> BoxFuture<'_, Result<AgentHandle, AgentPortError>> {
        self.start_calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async {
            Err(AgentPortError(
                "reconcile must not start a new chat".to_string(),
            ))
        })
    }
    fn watch<'a>(
        &'a self,
        _chat_id: &'a str,
    ) -> BoxFuture<'a, Result<AgentOutcome, AgentPortError>> {
        Box::pin(async {
            Ok(AgentOutcome::Completed {
                final_text: "resumed".to_string(),
            })
        })
    }
    fn retry<'a>(
        &'a self,
        _chat_id: &'a str,
        _correction: &'a str,
    ) -> BoxFuture<'a, Result<AgentOutcome, AgentPortError>> {
        Box::pin(async { Err(AgentPortError("no retry".to_string())) })
    }
    fn cancel<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, Result<(), AgentPortError>> {
        Box::pin(async { Ok(()) })
    }
}

fn standup_input(name: &str) -> AutomationCreateInput {
    AutomationCreateInput {
        name: name.to_string(),
        description: None,
        scope: AutomationScope::Global,
        project_id: None,
        definition: definition(vec![
            ask_agent_step("agent", false),
            notify_step("done", vec![text("done")]),
        ]),
    }
}

fn notify_input(name: &str) -> AutomationCreateInput {
    AutomationCreateInput {
        name: name.to_string(),
        description: None,
        scope: AutomationScope::Global,
        project_id: None,
        definition: definition(vec![notify_step("n1", vec![text("done")])]),
    }
}

fn ask_me_input(name: &str) -> AutomationCreateInput {
    AutomationCreateInput {
        name: name.to_string(),
        description: None,
        scope: AutomationScope::Global,
        project_id: None,
        definition: definition(vec![Step::AskMe(AskMeStep {
            id: "form".to_string(),
            keep_going: false,
            title: "Check-in".to_string(),
            fields: vec![AutomationFormField {
                key: "mood".to_string(),
                field_type: FormFieldType::Text,
                label: None,
                options: None,
                required: Some(false),
                show_when: None,
            }],
        })]),
    }
}

async fn wait_for_status(
    engine: &AutomationsEngine,
    run_id: &str,
    wanted: RunStatus,
) -> crate::store::RunRecord {
    for _ in 0..100 {
        let run = engine.get_run(run_id).await.unwrap().unwrap();
        if run.status == wanted {
            return run;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("run {run_id} never reached {wanted:?}");
}

#[tokio::test]
async fn create_lists_and_gets_summaries() {
    let (engine, _sink, _dir) = engine().await;
    let created = engine.create(notify_input("Daily")).await.unwrap();
    assert!(created.enabled);
    assert_eq!(created.name, "Daily");
    let listed = engine.list().await.unwrap();
    assert_eq!(listed.len(), 1);
    let got = engine.get(&created.id).await.unwrap().unwrap();
    assert_eq!(got.definition, created.definition);
}

#[tokio::test]
async fn create_rejects_an_invalid_definition_with_plain_language_errors() {
    let (engine, _sink, _dir) = engine().await;
    let mut input = notify_input("Broken");
    input.definition.steps.clear();
    let err = engine.create(input).await.unwrap_err();
    match err {
        EngineError::Validation { errors } => {
            assert_eq!(errors[0].message, "Add at least one step.");
        }
        other => panic!("expected validation error, got {other:?}"),
    }
}

#[tokio::test]
async fn update_missing_automation_is_not_found() {
    let (engine, _sink, _dir) = engine().await;
    let err = engine.update("ghost", notify_input("X")).await.unwrap_err();
    assert!(matches!(
        err,
        EngineError::Store(StoreError::NotFound { .. })
    ));
}

#[tokio::test]
async fn set_enabled_toggles_the_summary() {
    let (engine, _sink, _dir) = engine().await;
    let created = engine.create(notify_input("Toggle")).await.unwrap();
    let disabled = engine.set_enabled(&created.id, false).await.unwrap();
    assert!(!disabled.enabled);
    let enabled = engine.set_enabled(&created.id, true).await.unwrap();
    assert!(enabled.enabled);
}

#[tokio::test]
async fn manual_run_advances_to_succeeded_and_streams_updates() {
    let (engine, sink, _dir) = engine().await;
    let created = engine.create(notify_input("Runner")).await.unwrap();
    let run = engine.run_manually(&created.id).await.unwrap();
    let done = wait_for_status(&engine, &run.id, RunStatus::Succeeded).await;
    assert_eq!(done.checkpoint.steps.len(), 1);
    let updates = sink.run_updates();
    assert!(updates.iter().any(|u| u.id == run.id));
    let summaries = engine.list_runs(&created.id).await.unwrap();
    assert_eq!(summaries[0].status, RunStatus::Succeeded);
}

#[tokio::test]
async fn delete_cancels_active_runs_and_pending_interactions_first() {
    let (engine, sink, _dir) = engine().await;
    let created = engine.create(ask_me_input("Form")).await.unwrap();
    let run = engine.run_manually(&created.id).await.unwrap();
    wait_for_status(&engine, &run.id, RunStatus::Waiting).await;
    assert_eq!(engine.list_pending_interactions().await.unwrap().len(), 1);

    engine.delete(&created.id).await.unwrap();

    assert!(engine.get(&created.id).await.unwrap().is_none());
    // Rows cascade away with the automation; the cancel is observable on the
    // event stream (A8: cancel BEFORE dropping rows).
    let cancelled = sink
        .run_updates()
        .into_iter()
        .any(|u| u.id == run.id && u.status == RunStatus::Cancelled);
    assert!(cancelled, "delete must cancel the active run first");
    assert!(engine.list_pending_interactions().await.unwrap().is_empty());
}

#[tokio::test]
async fn delete_missing_automation_is_not_found() {
    let (engine, _sink, _dir) = engine().await;
    let err = engine.delete("ghost").await.unwrap_err();
    assert!(matches!(
        err,
        EngineError::Store(StoreError::NotFound { .. })
    ));
}

#[tokio::test]
async fn credentials_round_trip_without_exposing_secrets() {
    let (engine, _sink, _dir) = engine().await;
    engine
        .set_credential("github", "tok_123".to_string())
        .await
        .unwrap();
    assert_eq!(engine.credential_labels().await, vec!["github"]);
    let kind = engine.credential_kind("github").await.unwrap();
    assert_eq!(
        serde_json::to_value(kind).unwrap(),
        serde_json::json!("token")
    );
    engine.delete_credential("github").await.unwrap();
    assert!(engine.credential_labels().await.is_empty());
}

#[tokio::test]
async fn start_is_idempotent_and_double_start_errors() {
    let (engine, _sink, _dir) = engine().await;
    engine.start().await.unwrap();
    let err = engine.start().await.unwrap_err();
    assert!(matches!(err, StartError::AlreadyStarted));
}

#[tokio::test]
async fn start_reconciles_live_runs_and_reattaches_agent_watches() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("automations.db");
    let creds = dir.path().join("automation-credentials.json");

    // Engine 1 parks the ask_agent step and is then dropped mid-wait.
    let run_id = {
        let sink = Arc::new(CollectingSink::default());
        let engine1 = build_engine(&db_path, &creds, Arc::new(ParkingAgent), sink).await;
        let created = engine1.create(standup_input("Standup")).await.unwrap();
        let run = engine1.run_manually(&created.id).await.unwrap();
        let waiting = wait_for_status(&engine1, &run.id, RunStatus::Waiting).await;
        // The chat id is durably stamped on the checkpoint entry.
        let entry = waiting.checkpoint.steps.get("agent").unwrap();
        assert_eq!(entry.chat_id.as_deref(), Some("chat-parked"));
        run.id
    };

    // Engine 2 adopts the same store: reconcile re-attaches the watch, the
    // agent completes, and the run finishes WITHOUT starting a second chat.
    let sink = Arc::new(CollectingSink::default());
    let agent = Arc::new(AdoptingAgent::default());
    let engine2 = build_engine(&db_path, &creds, agent.clone(), sink).await;
    engine2.start().await.unwrap();

    let done = wait_for_status(&engine2, &run_id, RunStatus::Succeeded).await;
    assert_eq!(done.status, RunStatus::Succeeded);
    assert_eq!(
        agent.start_calls.load(Ordering::SeqCst),
        0,
        "reconcile must re-attach the existing chat, not open a new one"
    );
}
