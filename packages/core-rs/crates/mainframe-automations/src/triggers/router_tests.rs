//! T8.3 — event router + chaining: `session.finished` starts matching
//! automations with trigger tokens (agent-owned chats excluded); run
//! finalize emits `automation.completed{status}` and the
//! `automation.finished`/`automation.failed` selectors filter it by status
//! (they are trigger selectors, not separate events), firing the chained
//! automation with ⟨its result⟩.

use std::sync::Arc;
use std::time::Duration;

use serde_json::{Map, json};
use tempfile::TempDir;
use tokio::sync::broadcast;

use crate::domain::{
    AutomationCreateInput, AutomationDefinition, AutomationEventName, AutomationScope,
    EventTrigger, Step, Trigger,
};
use crate::engine::test_support::{CollectingSink, FakeClock, FakePorts, run_action_step};
use crate::engine::{Interpreter, InterpreterDeps, StepOutcome};
use crate::ports::{AutomationEvent, CompletedStatus, CuratedEvent, EventSource};
use crate::store::{AutomationDb, AutomationStore, RunStore, RunTriggerContext, RunTriggerKind};

use super::completion::CompletionEmitter;
use super::fire::TriggerFirer;
use super::router::{AgentOwnedChats, TriggerRouter, spawn_event_loop};

struct RouterHarness {
    _dir: TempDir,
    automations: AutomationStore,
    runs: RunStore,
    interpreter: Arc<Interpreter>,
    sink: Arc<CollectingSink>,
    router: Arc<TriggerRouter>,
}

struct OwnedChats(&'static str);

impl AgentOwnedChats for OwnedChats {
    fn is_agent_owned(&self, chat_id: &str) -> bool {
        chat_id == self.0
    }
}

async fn harness(ports: FakePorts, agent_owned: Option<Arc<dyn AgentOwnedChats>>) -> RouterHarness {
    let dir = tempfile::tempdir().unwrap();
    let db = AutomationDb::open(dir.path().join("automations.db"))
        .await
        .unwrap();
    let automations = AutomationStore::new(db.clone());
    let runs = RunStore::new(db);
    let sink = Arc::new(CollectingSink::default());
    let emitter = CompletionEmitter::new(automations.clone(), sink.clone());
    let interpreter = Arc::new(Interpreter::new(InterpreterDeps {
        store: runs.clone(),
        ports: Arc::new(ports),
        events: sink.clone(),
        clock: Arc::new(FakeClock),
        is_idempotent: None,
        agent_waits: None,
        on_finalized: Some(emitter.clone()),
    }));
    let firer = Arc::new(TriggerFirer::new(automations.clone(), interpreter.clone()));
    let router = Arc::new(TriggerRouter::new(automations.clone(), firer, agent_owned));
    emitter.bind_router(router.clone());
    RouterHarness {
        _dir: dir,
        automations,
        runs,
        interpreter,
        sink,
        router,
    }
}

async fn create(h: &RouterHarness, name: &str, triggers: Vec<Trigger>, steps: Vec<Step>) -> String {
    h.automations
        .create(AutomationCreateInput {
            name: name.to_string(),
            description: None,
            scope: AutomationScope::Global,
            project_id: None,
            definition: AutomationDefinition { triggers, steps },
        })
        .await
        .unwrap()
        .id
}

fn event_trigger(id: &str, event: AutomationEventName, filter: Option<&str>) -> Trigger {
    Trigger::Event(EventTrigger {
        id: id.to_string(),
        event,
        automation_id: filter.map(str::to_string),
    })
}

fn session_finished(chat_id: &str) -> CuratedEvent {
    CuratedEvent::SessionFinished {
        chat_id: chat_id.to_string(),
        reason: "completed".to_string(),
    }
}

fn completed_events(sink: &CollectingSink) -> Vec<AutomationEvent> {
    sink.events
        .lock()
        .unwrap()
        .iter()
        .filter(|e| matches!(e, AutomationEvent::Completed { .. }))
        .cloned()
        .collect()
}

#[tokio::test]
async fn session_finished_fires_matching_automations_with_trigger_tokens() {
    let h = harness(FakePorts::default(), None).await;
    let watcher = create(
        &h,
        "watcher",
        vec![event_trigger(
            "e1",
            AutomationEventName::SessionFinished,
            None,
        )],
        vec![],
    )
    .await;
    // A chained-only automation must not fire on session.finished.
    let other = create(
        &h,
        "chained-only",
        vec![event_trigger(
            "c1",
            AutomationEventName::AutomationFinished,
            None,
        )],
        vec![],
    )
    .await;

    h.router.handle_event(&session_finished("chat-9")).await;

    let runs = h.runs.list_runs(&watcher, 10).await.unwrap();
    assert_eq!(runs.len(), 1);
    let trigger = &runs[0].checkpoint.trigger;
    assert_eq!(trigger.kind, RunTriggerKind::Event);
    assert_eq!(trigger.trigger_id.as_deref(), Some("e1"));
    assert_eq!(
        trigger.payload,
        Some(json!({"result": "completed", "chatId": "chat-9"})),
        "trigger tokens carry result + chatId"
    );
    assert!(h.runs.list_runs(&other, 10).await.unwrap().is_empty());

    // Same source chat again → dedup key `e1|chat-9` loses the race.
    h.router.handle_event(&session_finished("chat-9")).await;
    assert_eq!(h.runs.list_runs(&watcher, 10).await.unwrap().len(), 1);

    // A different chat is a fresh dedup source.
    h.router.handle_event(&session_finished("chat-10")).await;
    assert_eq!(h.runs.list_runs(&watcher, 10).await.unwrap().len(), 2);
}

#[tokio::test]
async fn agent_owned_chats_do_not_fire_session_finished() {
    let h = harness(
        FakePorts::default(),
        Some(Arc::new(OwnedChats("agent-chat"))),
    )
    .await;
    let watcher = create(
        &h,
        "watcher",
        vec![event_trigger(
            "e1",
            AutomationEventName::SessionFinished,
            None,
        )],
        vec![],
    )
    .await;

    // That chat's completion already drives its own ask_agent step —
    // treating it as session.finished too would double-fire.
    h.router.handle_event(&session_finished("agent-chat")).await;
    assert!(h.runs.list_runs(&watcher, 10).await.unwrap().is_empty());

    h.router.handle_event(&session_finished("other-chat")).await;
    assert_eq!(h.runs.list_runs(&watcher, 10).await.unwrap().len(), 1);
}

#[tokio::test]
async fn finalize_emits_completed_and_fires_the_finished_selector_with_result() {
    let ports = FakePorts {
        run_action: Box::new(|_, _| {
            let mut outputs = Map::new();
            outputs.insert("output".to_string(), json!("42"));
            StepOutcome::Completed { outputs }
        }),
        ..Default::default()
    };
    let h = harness(ports, None).await;

    let source = create(
        &h,
        "source",
        vec![],
        vec![run_action_step("s1", "run_command", false)],
    )
    .await;
    let on_success = create(
        &h,
        "on-success",
        vec![event_trigger(
            "c1",
            AutomationEventName::AutomationFinished,
            Some(&source),
        )],
        vec![],
    )
    .await;
    let on_failure = create(
        &h,
        "on-failure",
        vec![event_trigger(
            "c2",
            AutomationEventName::AutomationFailed,
            Some(&source),
        )],
        vec![],
    )
    .await;
    let other_filter = create(
        &h,
        "other-filter",
        vec![event_trigger(
            "c3",
            AutomationEventName::AutomationFinished,
            Some("someone-else"),
        )],
        vec![],
    )
    .await;
    let any_source = create(
        &h,
        "any-source",
        vec![event_trigger(
            "c4",
            AutomationEventName::AutomationFinished,
            None,
        )],
        vec![],
    )
    .await;

    let source_def = h
        .automations
        .get(&source)
        .await
        .unwrap()
        .unwrap()
        .definition;
    let run = h
        .interpreter
        .start_run(&source, source_def, RunTriggerContext::manual(), None)
        .await
        .unwrap();
    h.interpreter.advance(&run.id).await.unwrap();

    let completed = completed_events(&h.sink);
    assert_eq!(completed.len(), 1, "exactly one automation.completed");
    match &completed[0] {
        AutomationEvent::Completed {
            automation_id,
            automation_name,
            run_id,
            status,
            result,
        } => {
            assert_eq!(automation_id, &source);
            assert_eq!(automation_name, "source");
            assert_eq!(run_id, &run.id);
            assert_eq!(*status, CompletedStatus::Succeeded);
            assert_eq!(result, "42", "⟨its result⟩ is the last step's output");
        }
        other => panic!("not a completed event: {other:?}"),
    }

    let chained = h.runs.list_runs(&on_success, 10).await.unwrap();
    assert_eq!(chained.len(), 1, "finished selector fired");
    assert_eq!(
        chained[0].checkpoint.trigger.payload,
        Some(json!({"result": "42"}))
    );
    assert!(h.runs.list_runs(&on_failure, 10).await.unwrap().is_empty());
    assert!(
        h.runs
            .list_runs(&other_filter, 10)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(h.runs.list_runs(&any_source, 10).await.unwrap().len(), 1);

    // A second source run is a fresh dedup source (keyed by run id).
    let source_def = h
        .automations
        .get(&source)
        .await
        .unwrap()
        .unwrap()
        .definition;
    let run2 = h
        .interpreter
        .start_run(&source, source_def, RunTriggerContext::manual(), None)
        .await
        .unwrap();
    h.interpreter.advance(&run2.id).await.unwrap();
    assert_eq!(h.runs.list_runs(&on_success, 10).await.unwrap().len(), 2);
}

#[tokio::test]
async fn failed_runs_fire_the_failed_selector_only() {
    let ports = FakePorts {
        run_action: Box::new(|_, _| StepOutcome::Failed {
            error: "boom".to_string(),
        }),
        ..Default::default()
    };
    let h = harness(ports, None).await;

    let source = create(
        &h,
        "source",
        vec![],
        vec![run_action_step("s1", "run_command", false)],
    )
    .await;
    let on_success = create(
        &h,
        "on-success",
        vec![event_trigger(
            "c1",
            AutomationEventName::AutomationFinished,
            Some(&source),
        )],
        vec![],
    )
    .await;
    let on_failure = create(
        &h,
        "on-failure",
        vec![event_trigger(
            "c2",
            AutomationEventName::AutomationFailed,
            Some(&source),
        )],
        vec![],
    )
    .await;

    let source_def = h
        .automations
        .get(&source)
        .await
        .unwrap()
        .unwrap()
        .definition;
    let run = h
        .interpreter
        .start_run(&source, source_def, RunTriggerContext::manual(), None)
        .await
        .unwrap();
    h.interpreter.advance(&run.id).await.unwrap();

    let source_run = h.runs.get_run(&run.id).await.unwrap().unwrap();
    let run_error = source_run.checkpoint.error.clone().unwrap();

    let completed = completed_events(&h.sink);
    assert_eq!(completed.len(), 1);
    match &completed[0] {
        AutomationEvent::Completed { status, result, .. } => {
            assert_eq!(*status, CompletedStatus::Failed);
            assert_eq!(result, &run_error, "failed result is the run error");
        }
        other => panic!("not a completed event: {other:?}"),
    }

    let chained = h.runs.list_runs(&on_failure, 10).await.unwrap();
    assert_eq!(chained.len(), 1, "failed selector fired");
    assert_eq!(
        chained[0].checkpoint.trigger.payload,
        Some(json!({"result": run_error}))
    );
    assert!(h.runs.list_runs(&on_success, 10).await.unwrap().is_empty());
}

#[tokio::test]
async fn cancelled_runs_emit_no_completion_event() {
    let h = harness(FakePorts::default(), None).await;
    let source = create(&h, "source", vec![], vec![]).await;
    let source_def = h
        .automations
        .get(&source)
        .await
        .unwrap()
        .unwrap()
        .definition;
    let run = h
        .interpreter
        .start_run(&source, source_def, RunTriggerContext::manual(), None)
        .await
        .unwrap();
    h.interpreter.cancel_run(&run.id).await.unwrap();

    assert!(completed_events(&h.sink).is_empty());
}

struct FakeEventSource {
    tx: broadcast::Sender<CuratedEvent>,
}

impl EventSource for FakeEventSource {
    fn subscribe(&self) -> broadcast::Receiver<CuratedEvent> {
        self.tx.subscribe()
    }
}

#[tokio::test]
async fn event_loop_subscribes_and_dispatches() {
    let h = harness(FakePorts::default(), None).await;
    let watcher = create(
        &h,
        "watcher",
        vec![event_trigger(
            "e1",
            AutomationEventName::SessionFinished,
            None,
        )],
        vec![],
    )
    .await;

    let (tx, _keepalive) = broadcast::channel(8);
    let source = Arc::new(FakeEventSource { tx: tx.clone() });
    let handle = spawn_event_loop(h.router.clone(), source);

    tx.send(session_finished("chat-1")).unwrap();
    let mut fired = false;
    for _ in 0..100 {
        if h.runs.list_runs(&watcher, 10).await.unwrap().len() == 1 {
            fired = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    handle.abort();
    assert!(fired, "the subscribed loop dispatched the event to a run");
}

#[test]
fn completed_event_wire_shape_matches_contract() {
    let event = AutomationEvent::Completed {
        automation_id: "a-1".to_string(),
        automation_name: "Ship work".to_string(),
        run_id: "r-1".to_string(),
        status: CompletedStatus::Succeeded,
        result: "done".to_string(),
    };
    assert_eq!(
        serde_json::to_value(&event).unwrap(),
        json!({
            "type": "automation.completed",
            "automationId": "a-1",
            "automationName": "Ship work",
            "runId": "r-1",
            "status": "succeeded",
            "result": "done",
        })
    );
}
