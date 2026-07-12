//! T10.3 durability matrix: for each pause point (waiting-on-form,
//! waiting-on-agent, mid-Repeat, mid-`running`), drop the engine and rebuild a
//! fresh one over the SAME db — a daemon crash-and-reboot. Assert the run
//! completes with no non-idempotent action re-executed, and the restart-mid-
//! `running` policy (idempotent re-runs, else fails loudly).
//!
//! The automations are DISABLED before their manual run so the boot sweep
//! injects no scheduled make-up runs — these tests isolate reconcile, and an
//! in-flight run reconciles regardless of the automation's enabled flag.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::json;
use tempfile::TempDir;

use crate::harness::{
    CollectingSink, FakeActions, FakeAgentPort, FakeNotifier, answers, build_actions, build_engine,
    load_fixture, wait_action, wait_status,
};
use mainframe_automations::AutomationsEngine;
use mainframe_automations::store::RunStatus;

struct Boot {
    engine: Arc<AutomationsEngine>,
    agent: Arc<FakeAgentPort>,
    notifier: Arc<FakeNotifier>,
    actions: FakeActions,
}

fn db_paths(dir: &TempDir) -> (PathBuf, PathBuf) {
    (
        dir.path().join("automations.db"),
        dir.path().join("automation-credentials.json"),
    )
}

async fn boot(db: &Path, creds: &Path, agent: FakeAgentPort) -> Boot {
    let agent = Arc::new(agent);
    let notifier = Arc::new(FakeNotifier::default());
    let sink = Arc::new(CollectingSink::default());
    let actions = build_actions();
    let engine = build_engine(db, creds, agent.clone(), notifier.clone(), sink, &actions).await;
    Boot {
        engine,
        agent,
        notifier,
        actions,
    }
}

/// Create + disable + manual-run: disabling quiesces the scheduler so only the
/// in-flight run under test exists.
async fn start_manual(engine: &AutomationsEngine, fixture: &str) -> String {
    let created = engine.create(load_fixture(fixture)).await.unwrap();
    engine.set_enabled(&created.id, false).await.unwrap();
    engine.run_manually(&created.id).await.unwrap().id
}

fn health_answers() -> serde_json::Map<String, serde_json::Value> {
    answers(json!({ "mood": "great", "appetite": "normal", "sleep": 7, "symptoms": ["cough"] }))
}

async fn first_pending(engine: &AutomationsEngine) -> String {
    engine
        .list_pending_interactions()
        .await
        .unwrap()
        .into_iter()
        .next()
        .expect("a pending interaction")
        .id
}

#[tokio::test]
async fn waiting_on_form_resumes_and_runs_actions_once() {
    let dir = tempfile::tempdir().unwrap();
    let (db, creds) = db_paths(&dir);

    let run_id = {
        let b1 = boot(&db, &creds, FakeAgentPort::completing("")).await;
        let run_id = start_manual(&b1.engine, "daily-health-log").await;
        wait_status(&b1.engine, &run_id, RunStatus::Waiting).await;
        run_id
    };

    // A fresh engine adopts the pending interaction; answering resumes the run.
    let b2 = boot(&db, &creds, FakeAgentPort::completing("")).await;
    b2.engine.start().await.unwrap();
    let interaction = first_pending(&b2.engine).await;
    b2.engine
        .respond(&interaction, health_answers())
        .await
        .unwrap();
    wait_status(&b2.engine, &run_id, RunStatus::Succeeded).await;

    assert_eq!(b2.actions.recorder.count("notion.add_row"), 1);
    assert_eq!(b2.actions.recorder.count("files.append"), 1);
}

#[tokio::test]
async fn waiting_on_agent_resumes_without_a_new_chat() {
    let dir = tempfile::tempdir().unwrap();
    let (db, creds) = db_paths(&dir);

    let run_id = {
        let b1 = boot(&db, &creds, FakeAgentPort::manual()).await;
        let run_id = start_manual(&b1.engine, "daily-standup").await;
        wait_status(&b1.engine, &run_id, RunStatus::Waiting).await;
        run_id
    };

    let b2 = boot(&db, &creds, FakeAgentPort::completing("the plan")).await;
    b2.engine.start().await.unwrap();
    wait_status(&b2.engine, &run_id, RunStatus::Succeeded).await;

    assert_eq!(b2.agent.start_count(), 0, "reconcile re-attached the chat");
    assert_eq!(b2.notifier.sent.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn mid_repeat_resumes_without_rerunning_the_list_action() {
    let dir = tempfile::tempdir().unwrap();
    let (db, creds) = db_paths(&dir);

    let run_id = {
        let b1 = boot(&db, &creds, FakeAgentPort::manual()).await;
        let run_id = start_manual(&b1.engine, "morning-pr-sweep").await;
        // list_prs ran; the first repeat iteration parked on its agent.
        wait_status(&b1.engine, &run_id, RunStatus::Waiting).await;
        assert_eq!(b1.actions.recorder.count("github.list_prs"), 1);
        run_id
    };

    let b2 = boot(&db, &creds, FakeAgentPort::completing("reviewed")).await;
    b2.agent.seed_chat_seq(100); // new chats never collide with the resumed one
    b2.engine.start().await.unwrap();
    wait_status(&b2.engine, &run_id, RunStatus::Succeeded).await;

    assert_eq!(
        b2.actions.recorder.count("github.list_prs"),
        0,
        "the committed list action is not re-run"
    );
    assert_eq!(
        b2.agent.start_count(),
        1,
        "only the second iteration opens a fresh chat"
    );
}

#[tokio::test]
async fn restart_mid_running_nonidempotent_fails_loudly() {
    let dir = tempfile::tempdir().unwrap();
    let (db, creds) = db_paths(&dir);

    let run_id = {
        let b1 = boot(&db, &creds, FakeAgentPort::completing("")).await;
        b1.actions.gate("files.append").hold();
        let run_id = start_manual(&b1.engine, "daily-health-log").await;
        wait_status(&b1.engine, &run_id, RunStatus::Waiting).await;
        let interaction = first_pending(&b1.engine).await;
        // respond drives the walk synchronously; it blocks at the held gate.
        let engine = b1.engine.clone();
        tokio::spawn(async move { engine.respond(&interaction, health_answers()).await.ok() });
        wait_action(&b1.actions.recorder, "files.append", 1).await;
        assert_eq!(b1.actions.recorder.count("notion.add_row"), 1);
        run_id
    };

    // The step was `running` (non-idempotent) at the crash → fail loudly.
    let b2 = boot(&db, &creds, FakeAgentPort::completing("")).await;
    b2.engine.start().await.unwrap();
    let failed = wait_status(&b2.engine, &run_id, RunStatus::Failed).await;
    assert!(
        failed
            .checkpoint
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("engine restarted mid-action"),
        "unexpected error: {:?}",
        failed.checkpoint.error
    );
    assert_eq!(
        b2.actions.recorder.count("notion.add_row"),
        0,
        "committed step not re-run"
    );
    assert_eq!(
        b2.actions.recorder.count("files.append"),
        0,
        "mid-action step not re-run"
    );
}

#[tokio::test]
async fn restart_mid_running_idempotent_reruns() {
    let dir = tempfile::tempdir().unwrap();
    let (db, creds) = db_paths(&dir);

    let run_id = {
        let b1 = boot(&db, &creds, FakeAgentPort::manual()).await;
        b1.actions.gate("github.list_prs").hold();
        let run_id = start_manual(&b1.engine, "morning-pr-sweep").await;
        wait_action(&b1.actions.recorder, "github.list_prs", 1).await;
        run_id
    };

    // list_prs is idempotent → the walk blindly re-runs it, then completes.
    let b2 = boot(&db, &creds, FakeAgentPort::completing("reviewed")).await;
    b2.engine.start().await.unwrap();
    wait_status(&b2.engine, &run_id, RunStatus::Succeeded).await;
    assert_eq!(
        b2.actions.recorder.count("github.list_prs"),
        1,
        "the idempotent step is re-run on restart"
    );
}
