//! §12 Daily feature spike (the augmented A1/A2/A3 fixture). Exercises A2
//! structured `expects`, the A3 `is_one_of` gate, and A1 run_command chip
//! isolation. R6 (contract §9): the agent's auto-approve scope + time budget
//! have no ChatManager parameter today, so the test asserts they reach the
//! recording AgentPort boundary intact — the engine forwards them, never
//! silently drops them, so the gap cannot hide behind a green suite.

use crate::harness::Rig;
use mainframe_automations::store::RunStatus;
use serde_json::{Value, json};

/// The in-scope path: A2 parses `scope=xs`, the A3 gate passes, the guarded
/// build runs, and the shipped notice fires.
#[tokio::test]
async fn feature_spike_in_scope_runs_the_guarded_build() {
    let rig = Rig::completing(r#"Picked one. {"scope": "xs"}"#).await;
    let run_id = rig.start("daily-feature-spike").await;
    rig.wait(&run_id, RunStatus::Succeeded).await;

    // R6 boundary: auto-approve scope + time budget + worktree reach the port.
    let requests = rig.agent.started_requests();
    assert_eq!(requests.len(), 1);
    let req = &requests[0];
    assert_eq!(
        req.auto_approve,
        Some(vec![
            "edits".to_string(),
            "pnpm".to_string(),
            "git".to_string()
        ])
    );
    assert_eq!(req.timeout_minutes, Some(240));
    let worktree = req.worktree.as_ref().expect("worktree request");
    assert_eq!(worktree.base_branch.as_deref(), Some("main"));
    assert_eq!(worktree.branch_name, "feature-spike-2026-07-12");

    // A2: the expects contract rides the prompt and declares the `scope` key.
    assert_eq!(req.expects.len(), 1);
    assert_eq!(req.expects[0].key, "scope");
    assert!(req.prompt.contains("Read docs/ideas"));
    assert!(
        req.prompt
            .contains("End your final message with a JSON object")
    );

    // A3 gate → the then-branch. A1: the ⟨scope⟩ chip stays its own script part
    // ({"chip":"xs"}), never spliced into the surrounding literal.
    let cmd = rig.recorded("run_command");
    assert_eq!(cmd.len(), 1);
    let script = cmd[0]
        .get("script")
        .and_then(Value::as_array)
        .expect("script parts");
    assert!(
        script.contains(&json!({ "chip": "xs" })),
        "the scope chip must be an isolated part, got {script:?}"
    );

    let bodies = rig.notifier.bodies();
    assert_eq!(
        bodies,
        vec!["Feature spike shipped at scope xs.".to_string()]
    );
}

/// The out-of-scope path: A2 parses `scope=m`, the A3 `is_one_of [xs,s]` gate
/// fails, so the otherwise branch skips the build and only notifies.
#[tokio::test]
async fn feature_spike_out_of_scope_skips_the_build() {
    let rig = Rig::completing(r#"{"scope": "m"}"#).await;
    let run_id = rig.start("daily-feature-spike").await;
    rig.wait(&run_id, RunStatus::Succeeded).await;

    assert_eq!(
        rig.recorded("run_command").len(),
        0,
        "gate must skip the build"
    );
    let bodies = rig.notifier.bodies();
    assert_eq!(bodies, vec!["Skipped: scope m is not xs or s.".to_string()]);
}
