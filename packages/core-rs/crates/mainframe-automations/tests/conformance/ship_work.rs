//! §12 Ship work: a manual run whose showWhen form drives an If. The "create
//! new" branch files an ADO item and threads its id into the PR body; the
//! "skip" branch leaves ⟨workItemId⟩ unset so it renders empty.

use crate::harness::Rig;
use mainframe_automations::store::RunStatus;
use serde_json::{Value, json};

fn field<'a>(params: &'a Value, key: &str) -> &'a str {
    params
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("<missing>")
}

#[tokio::test]
async fn ship_work_create_new_threads_the_ado_id_into_the_pr_body() {
    let rig = Rig::completing("worktree cleaned up").await;
    let run_id = rig.start("ship-work").await;
    rig.wait(&run_id, RunStatus::Waiting).await;
    let interaction = rig.pending().await;

    rig.respond(
        &interaction.id,
        json!({ "action": "create new", "title": "Ship it", "description": "the work" }),
    )
    .await;
    rig.wait(&run_id, RunStatus::Succeeded).await;

    // If ⟨action⟩ is "create new" → the ADO item is filed once.
    let ado = rig.recorded("ado.create_item");
    assert_eq!(ado.len(), 1);
    assert_eq!(field(&ado[0], "title"), "Ship it");

    // Its workItemId (42) threads into the PR body; ⟨Today⟩ into the branch.
    let pr = rig.recorded("github.create_pr");
    assert_eq!(pr.len(), 1);
    assert_eq!(field(&pr[0], "body"), "Ships the work. AB#42");
    assert_eq!(field(&pr[0], "head"), "ship/2026-07-12");
}

#[tokio::test]
async fn ship_work_skip_leaves_the_unset_work_item_token_empty() {
    let rig = Rig::completing("worktree cleaned up").await;
    let run_id = rig.start("ship-work").await;
    rig.wait(&run_id, RunStatus::Waiting).await;
    let interaction = rig.pending().await;

    rig.respond(&interaction.id, json!({ "action": "skip" }))
        .await;
    rig.wait(&run_id, RunStatus::Succeeded).await;

    // The If's otherwise branch is empty → no ADO item is created.
    assert_eq!(rig.recorded("ado.create_item").len(), 0);

    // ⟨workItemId⟩ (from the skipped ADO step) is unset → renders empty.
    let pr = rig.recorded("github.create_pr");
    assert_eq!(pr.len(), 1);
    assert_eq!(field(&pr[0], "body"), "Ships the work. AB#");
    assert_eq!(field(&pr[0], "title"), "");
}
