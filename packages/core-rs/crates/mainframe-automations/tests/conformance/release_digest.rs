//! §12 Release digest: the `$name` fixture. A `once` schedule, a set_variable
//! reading two of the agent's expected outputs, `$item.title` per iteration,
//! and a digest that addresses a value produced *before* a repeat block.

use crate::harness::Rig;
use mainframe_automations::store::RunStatus;

/// The agent's final text: prose plus the JSON object `expects` parses.
const FINAL_TEXT: &str = concat!(
    "Two PRs landed since the last tag.\n",
    r#"{"merged":[{"title":"Add cache"},{"title":"Fix leak"}],"version":"v2.0"}"#
);

#[tokio::test]
async fn release_digest_renders_every_name_the_fixture_addresses() {
    let rig = Rig::completing(FINAL_TEXT).await;
    let run_id = rig.start("release-digest").await;
    rig.wait(&run_id, RunStatus::Succeeded).await;

    // The collector runs once, then one drafting session per merged PR with
    // `$item.title` resolved to that iteration's record.
    let prompts: Vec<String> = rig
        .agent
        .started_requests()
        .into_iter()
        .map(|r| r.prompt)
        .collect();
    assert_eq!(prompts.len(), 3);
    assert_eq!(
        &prompts[1..],
        [
            "Write one sentence for the release notes about Add cache.",
            "Write one sentence for the release notes about Fix leak.",
        ]
    );

    // `$headline` carries the set_variable's own render (`$version` + the
    // `$today` builtin, frozen by FakeClock); `$agent_result` resolves to the
    // collector, not to the drafting agent the repeat body isolated.
    assert_eq!(
        rig.notifier.bodies(),
        [format!(
            "Release v2.0 — shipped 2026-07-12\n\n\
             Merged since the last release:\n\
             {{\"title\":\"Add cache\"}}\n{{\"title\":\"Fix leak\"}}\n\n\
             Full summary:\n{FINAL_TEXT}"
        )]
    );
}
