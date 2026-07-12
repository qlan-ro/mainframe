//! §12 Morning PR sweep: a list action's output drives a Repeat that opens one
//! agent session per PR, each with ⟨Current PR → URL⟩ rendered per iteration.

use crate::harness::Rig;
use mainframe_automations::store::RunStatus;

#[tokio::test]
async fn pr_sweep_dispatches_one_agent_per_pr_with_the_right_url() {
    let rig = Rig::completing("reviewed").await;
    let run_id = rig.start("morning-pr-sweep").await;
    rig.wait(&run_id, RunStatus::Succeeded).await;

    // The list action ran once; its `prs` output drove two iterations.
    assert_eq!(rig.recorded("github.list_prs").len(), 1);

    // One agent session per PR, ⟨Current PR → URL⟩ correct per iteration.
    let prompts: Vec<String> = rig
        .agent
        .started_requests()
        .into_iter()
        .map(|r| r.prompt)
        .collect();
    assert_eq!(
        prompts,
        vec![
            "/codex-review https://github.com/o/r/pull/1".to_string(),
            "/codex-review https://github.com/o/r/pull/2".to_string(),
        ]
    );
}
