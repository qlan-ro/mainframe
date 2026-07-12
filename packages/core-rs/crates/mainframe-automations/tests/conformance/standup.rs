//! §12 Daily standup: a scheduled ask_agent whose result links into the notify
//! payload. Driven via a manual run — the schedule trigger's timing is proven
//! by the sweep unit tests; here the DO pipeline is what matters.

use crate::harness::Rig;
use mainframe_automations::store::RunStatus;

#[tokio::test]
async fn standup_agent_session_links_into_the_notify_payload() {
    let rig = Rig::completing("Here is your plan for today.").await;
    let run_id = rig.start("daily-standup").await;
    rig.wait(&run_id, RunStatus::Succeeded).await;

    // One agent session, prompt rendered from the slash-command chip.
    let requests = rig.agent.started_requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].prompt, "/pending-work");

    // The notify step fires once; the agent's chat id links into its payload.
    let sent = rig.notifier.sent.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].body, "Your day plan is ready.");
    assert_eq!(sent[0].links.chat_ids, vec!["chat-1".to_string()]);
}
