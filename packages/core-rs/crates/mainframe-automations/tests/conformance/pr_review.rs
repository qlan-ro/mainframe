//! §12 PR auto-review: a webhook delivery whose payload's ⟨PR URL⟩ renders
//! into the agent prompt. Exercises the real signature-verify → payload-token
//! → prompt-render path end-to-end.

use crate::harness::{Rig, deliver_webhook, load_fixture};
use mainframe_automations::store::RunStatus;
use mainframe_automations::triggers::WebhookDecision;
use serde_json::json;

#[tokio::test]
async fn pr_review_renders_the_pr_url_into_the_agent_prompt() {
    let rig = Rig::completing("reviewed").await;
    rig.engine
        .create(load_fixture("pr-auto-review"))
        .await
        .unwrap();
    let secret = "webhook-signing-secret";
    rig.engine
        .set_credential("webhook:github-pr-opened", secret.to_string())
        .await
        .unwrap();

    let body = json!({
        "action": "opened",
        "pull_request": { "html_url": "https://github.com/o/r/pull/7" }
    });
    let decision =
        deliver_webhook(&rig.engine, "github-pr-opened", secret, &body, "delivery-1").await;
    let run_id = match decision {
        WebhookDecision::Accepted { run_id: Some(id) } => id,
        other => panic!("expected an accepted run, got {other:?}"),
    };
    rig.wait(&run_id, RunStatus::Succeeded).await;

    let requests = rig.agent.started_requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(
        requests[0].prompt,
        "/codex-review https://github.com/o/r/pull/7"
    );
}
