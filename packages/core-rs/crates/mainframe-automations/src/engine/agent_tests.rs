//! T4.3 — ask_agent verb over AgentPort: park with chatId, durable wait,
//! completion resume, error policy, restart re-watch, deadline sweep.

use std::sync::{Arc, Mutex};

use serde_json::json;

use crate::domain::{AskAgentStep, Step, WorktreeSpec};
use crate::ports::{AgentOutcome, AgentPortError};
use crate::store::{RunStatus, StepStatus};

use super::Interpreter;
use super::agent::AgentVerb;
use super::agent_test_support::{FakeAgentPort, agent_rig, wait_for_run};
use super::test_support::{
    FakePorts, ask_agent_step, completed, definition, empty_outputs, manual, manual_with_payload,
    notify_step, text, token,
};

fn agent_with_prompt(id: &str, prompt: Vec<crate::domain::ChipPart>) -> Step {
    match ask_agent_step(id, false) {
        Step::AskAgent(mut step) => {
            step.prompt = prompt;
            Step::AskAgent(step)
        }
        _ => unreachable!(),
    }
}

#[tokio::test]
async fn ask_agent_parks_waiting_with_chat_id_and_rendered_prompt() {
    let rig = agent_rig(FakePorts::default()).await;
    let def = definition(vec![agent_with_prompt(
        "agent-1",
        vec![text("Review "), token("trigger", "url", None)],
    )]);
    let run = rig
        .engine
        .start_run(
            &rig.h.automation_id,
            def,
            manual_with_payload(json!({"url": "https://pr/7"})),
            None,
        )
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();

    let parked = rig.h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(parked.status, RunStatus::Waiting);
    let entry = &parked.checkpoint.steps["agent-1"];
    assert_eq!(entry.status, StepStatus::Waiting);
    assert_eq!(entry.chat_id.as_deref(), Some("chat-1"));

    let started = rig.port.started.lock().unwrap();
    assert_eq!(started.len(), 1);
    assert_eq!(started[0].prompt, "Review https://pr/7");
    assert_eq!(started[0].adapter_id, "claude");
}

#[tokio::test]
async fn ask_agent_forwards_options_to_the_port_boundary() {
    let rig = agent_rig(FakePorts::default()).await;
    let step = AskAgentStep {
        id: "agent-1".to_string(),
        keep_going: false,
        prompt: vec![text("go")],
        adapter_id: Some("codex".to_string()),
        model: Some("gpt-5.5".to_string()),
        permission_mode: Some("acceptEdits".to_string()),
        project_id: Some("proj-1".to_string()),
        worktree: Some(WorktreeSpec {
            base_branch: Some("main".to_string()),
            branch_name: vec![text("auto/"), token("trigger", "slug", None)],
        }),
        auto_approve: Some(vec!["git".to_string()]),
        timeout_minutes: Some(30),
        expects: None,
        attachments: Some(vec!["/tmp/shot.png".to_string()]),
    };
    let def = definition(vec![Step::AskAgent(step)]);
    let run = rig
        .engine
        .start_run(
            &rig.h.automation_id,
            def,
            manual_with_payload(json!({"slug": "fix-7"})),
            None,
        )
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();

    let request = rig.port.started.lock().unwrap()[0].clone();
    assert_eq!(request.adapter_id, "codex");
    assert_eq!(request.model.as_deref(), Some("gpt-5.5"));
    assert_eq!(request.permission_mode.as_deref(), Some("acceptEdits"));
    assert_eq!(request.project_id.as_deref(), Some("proj-1"));
    let worktree = request.worktree.as_ref().unwrap();
    assert_eq!(worktree.base_branch.as_deref(), Some("main"));
    assert_eq!(worktree.branch_name, "auto/fix-7");
    // R6: auto-approve/budget reach the AgentPort boundary — never dropped.
    assert_eq!(
        request.auto_approve.as_deref(),
        Some(&["git".to_string()][..])
    );
    assert_eq!(request.timeout_minutes, Some(30));
    assert_eq!(request.attachments, vec!["/tmp/shot.png".to_string()]);

    // The timeout is durable: wakeAt is armed on the parked checkpoint.
    let parked = rig.h.store.get_run(&run.id).await.unwrap().unwrap();
    assert!(parked.checkpoint.wake_at.is_some());
}

#[tokio::test]
async fn agent_completion_succeeds_step_with_named_outputs_and_resumes() {
    let notify_calls = Arc::new(Mutex::new(Vec::<String>::new()));
    let notified = notify_calls.clone();
    let rig = agent_rig(FakePorts {
        notify: Box::new(move |step, _| {
            notified.lock().unwrap().push(step.id.clone());
            completed(empty_outputs())
        }),
        ..FakePorts::default()
    })
    .await;
    let def = definition(vec![
        ask_agent_step("agent-1", false),
        notify_step("done", vec![text("finished")]),
    ]);
    let run = rig
        .engine
        .start_run(&rig.h.automation_id, def, manual(), None)
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();

    rig.port.complete(
        "chat-1",
        Ok(AgentOutcome::Completed {
            final_text: "all done".to_string(),
        }),
    );

    let finished = wait_for_run(&rig.h.store, &run.id, |r| r.status == RunStatus::Succeeded).await;
    let entry = &finished.checkpoint.steps["agent-1"];
    assert_eq!(entry.status, StepStatus::Succeeded);
    let outputs = entry.outputs.as_ref().unwrap();
    assert_eq!(outputs["result"], json!("all done"));
    assert_eq!(outputs["chatId"], json!("chat-1"));
    assert_eq!(*notify_calls.lock().unwrap(), vec!["done".to_string()]);
}

#[tokio::test]
async fn agent_error_fails_the_step_and_the_run() {
    let rig = agent_rig(FakePorts::default()).await;
    let def = definition(vec![ask_agent_step("agent-1", false)]);
    let run = rig
        .engine
        .start_run(&rig.h.automation_id, def, manual(), None)
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();

    rig.port.complete("chat-1", Ok(AgentOutcome::Errored));

    let finished = wait_for_run(&rig.h.store, &run.id, |r| r.status == RunStatus::Failed).await;
    let entry = &finished.checkpoint.steps["agent-1"];
    assert_eq!(entry.status, StepStatus::Failed);
    assert_eq!(entry.error.as_deref(), Some("agent chat error"));
    assert_eq!(
        finished.checkpoint.error.as_deref(),
        Some("agent chat error")
    );
}

#[tokio::test]
async fn agent_interrupt_with_keep_going_continues_the_run() {
    let notify_calls = Arc::new(Mutex::new(Vec::<String>::new()));
    let notified = notify_calls.clone();
    let rig = agent_rig(FakePorts {
        notify: Box::new(move |step, _| {
            notified.lock().unwrap().push(step.id.clone());
            completed(empty_outputs())
        }),
        ..FakePorts::default()
    })
    .await;
    let def = definition(vec![
        ask_agent_step("agent-1", true),
        notify_step("done", vec![text("finished")]),
    ]);
    let run = rig
        .engine
        .start_run(&rig.h.automation_id, def, manual(), None)
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();

    rig.port.complete("chat-1", Ok(AgentOutcome::Interrupted));

    let finished = wait_for_run(&rig.h.store, &run.id, |r| r.status == RunStatus::Succeeded).await;
    assert_eq!(
        finished.checkpoint.steps["agent-1"].error.as_deref(),
        Some("agent chat interrupted")
    );
    assert_eq!(*notify_calls.lock().unwrap(), vec!["done".to_string()]);
}

#[tokio::test]
async fn start_failure_fails_the_step_without_a_wait() {
    let rig = agent_rig(FakePorts::default()).await;
    *rig.port.start_error.lock().unwrap() = Some("no project".to_string());
    let def = definition(vec![ask_agent_step("agent-1", false)]);
    let run = rig
        .engine
        .start_run(&rig.h.automation_id, def, manual(), None)
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();

    let finished = rig.h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Failed);
    assert_eq!(finished.checkpoint.error.as_deref(), Some("no project"));
    assert!(rig.port.watch_calls.lock().unwrap().is_empty());
}

/// Durable wait: a fresh engine over the same store re-attaches via
/// AgentPort::watch for `waiting` ask_agent entries.
#[tokio::test]
async fn resume_after_restart_watches_waiting_agent_entries() {
    let rig = agent_rig(FakePorts::default()).await;
    let def = definition(vec![ask_agent_step("agent-1", false)]);
    let run = rig
        .engine
        .start_run(&rig.h.automation_id, def, manual(), None)
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();

    // "Restart": a second verb + interpreter over the same store, new port.
    let port2 = Arc::new(FakeAgentPort::default());
    let verb2 = AgentVerb::new(port2.clone(), rig.h.store.clone(), rig.h.sink.clone());
    let mut deps = rig.h.deps(FakePorts::default());
    deps.agent_waits = Some(verb2.clone());
    let engine2 = Arc::new(Interpreter::new(deps));
    verb2.bind_advancer(engine2.clone());

    let parked = rig.h.store.get_run(&run.id).await.unwrap().unwrap();
    verb2.resume_run_watches(&parked);

    // Poll: the watch attach is a spawned task.
    for _ in 0..200 {
        if !port2.watch_calls.lock().unwrap().is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    }
    assert_eq!(
        *port2.watch_calls.lock().unwrap(),
        vec!["chat-1".to_string()]
    );

    port2.complete(
        "chat-1",
        Ok(AgentOutcome::Completed {
            final_text: "resumed".to_string(),
        }),
    );
    let finished = wait_for_run(&rig.h.store, &run.id, |r| r.status == RunStatus::Succeeded).await;
    let outputs = finished.checkpoint.steps["agent-1"]
        .outputs
        .as_ref()
        .unwrap();
    assert_eq!(outputs["result"], json!("resumed"));
}

#[tokio::test]
async fn deadline_sweep_fails_an_overdue_agent_step() {
    let rig = agent_rig(FakePorts::default()).await;
    let step = match ask_agent_step("agent-1", false) {
        Step::AskAgent(mut s) => {
            s.timeout_minutes = Some(1);
            Step::AskAgent(s)
        }
        _ => unreachable!(),
    };
    let def = definition(vec![step]);
    let run = rig
        .engine
        .start_run(&rig.h.automation_id, def, manual(), None)
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();

    let parked = rig.h.store.get_run(&run.id).await.unwrap().unwrap();
    let wake_at = parked.checkpoint.wake_at.unwrap();

    // Not due yet: nothing changes.
    rig.engine.sweep_deadlines(wake_at - 1).await.unwrap();
    assert_eq!(
        rig.h.store.get_run(&run.id).await.unwrap().unwrap().status,
        RunStatus::Waiting
    );

    rig.engine.sweep_deadlines(wake_at + 1).await.unwrap();
    let finished = rig.h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Failed);
    assert_eq!(
        finished.checkpoint.steps["agent-1"].error.as_deref(),
        Some("agent step deadline exceeded")
    );
}

#[tokio::test]
async fn a_late_watch_error_after_success_is_dropped() {
    // The settle path must ignore an outcome for a chat whose wait is gone
    // (e.g. an errored duplicate delivery after the step already settled).
    let rig = agent_rig(FakePorts::default()).await;
    let def = definition(vec![ask_agent_step("agent-1", false)]);
    let run = rig
        .engine
        .start_run(&rig.h.automation_id, def, manual(), None)
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();

    rig.port.complete(
        "chat-1",
        Ok(AgentOutcome::Completed {
            final_text: "ok".to_string(),
        }),
    );
    wait_for_run(&rig.h.store, &run.id, |r| r.status == RunStatus::Succeeded).await;

    // A second outcome for the same chat has nobody waiting — nothing changes.
    rig.port
        .complete("chat-1", Err(AgentPortError("boom".to_string())));
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    assert_eq!(
        rig.h.store.get_run(&run.id).await.unwrap().unwrap().status,
        RunStatus::Succeeded
    );
}
