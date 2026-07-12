//! T10.3 cancel matrix: cancelling during an agent wait, mid-Repeat, and
//! before finalize (mid-`running`) all finalize the run `cancelled`, and a
//! late agent completion for a cancelled run is a NO-OP (A8 — no resurrection).
//! Single-engine (no boot sweep), so the only run is the one under test.

use std::time::Duration;

use serde_json::json;

use crate::harness::{Rig, answers, wait_action};
use mainframe_automations::ports::AgentOutcome;
use mainframe_automations::store::RunStatus;

fn late_completion() -> Result<AgentOutcome, mainframe_automations::ports::AgentPortError> {
    Ok(AgentOutcome::Completed {
        final_text: "arrived after cancel".to_string(),
    })
}

#[tokio::test]
async fn cancel_during_agent_wait_ignores_a_late_completion() {
    let rig = Rig::manual_agent().await;
    let run_id = rig.start("daily-standup").await;
    rig.wait(&run_id, RunStatus::Waiting).await;

    rig.engine.cancel_run(&run_id).await.unwrap();
    rig.wait(&run_id, RunStatus::Cancelled).await;
    assert!(
        rig.agent
            .cancels
            .lock()
            .unwrap()
            .contains(&"chat-1".to_string()),
        "cancel told the chat to stop"
    );

    // The agent finishes late — the wait registration is already gone, so it
    // is dropped: the run stays cancelled and the notify step never runs.
    rig.agent.complete("chat-1", late_completion());
    tokio::time::sleep(Duration::from_millis(50)).await;
    let run = rig.engine.get_run(&run_id).await.unwrap().unwrap();
    assert_eq!(run.status, RunStatus::Cancelled, "no resurrection");
    assert_eq!(
        rig.notifier.sent.lock().unwrap().len(),
        0,
        "notify never ran"
    );
}

#[tokio::test]
async fn cancel_mid_repeat_ignores_a_late_completion() {
    let rig = Rig::manual_agent().await;
    let run_id = rig.start("morning-pr-sweep").await;
    rig.wait(&run_id, RunStatus::Waiting).await; // parked on the first iteration
    assert_eq!(rig.agent.start_count(), 1);

    rig.engine.cancel_run(&run_id).await.unwrap();
    rig.wait(&run_id, RunStatus::Cancelled).await;

    rig.agent.complete("chat-1", late_completion());
    tokio::time::sleep(Duration::from_millis(50)).await;
    let run = rig.engine.get_run(&run_id).await.unwrap().unwrap();
    assert_eq!(run.status, RunStatus::Cancelled);
    assert_eq!(
        rig.agent.start_count(),
        1,
        "the second iteration never started"
    );
}

#[tokio::test]
async fn cancel_before_finalize_aborts_a_running_action() {
    let rig = Rig::completing("").await;
    rig.actions.gate("files.append").hold();
    let run_id = rig.start("daily-health-log").await;
    rig.wait(&run_id, RunStatus::Waiting).await;
    let interaction = rig.pending().await;

    // Answer in the background; the walk runs notion, then blocks in
    // files.append with the step committed `running`.
    let engine = rig.engine.clone();
    let payload = answers(
        json!({ "mood": "great", "appetite": "normal", "sleep": 7, "symptoms": ["cough"] }),
    );
    tokio::spawn(async move { engine.respond(&interaction.id, payload).await.ok() });
    wait_action(&rig.actions.recorder, "files.append", 1).await;

    rig.engine.cancel_run(&run_id).await.unwrap();
    rig.wait(&run_id, RunStatus::Cancelled).await;

    // Releasing the gate cannot resurrect the run: the aborted walk future was
    // dropped, and the A8 store guard rejects any straggler commit.
    rig.actions.gate("files.append").release();
    tokio::time::sleep(Duration::from_millis(50)).await;
    let run = rig.engine.get_run(&run_id).await.unwrap().unwrap();
    assert_eq!(run.status, RunStatus::Cancelled);
}
