use std::sync::Mutex;

use mainframe_types::orchestration::SecretToken;

use super::*;

#[derive(Default)]
struct Recorder {
    calls: Mutex<Vec<String>>,
}

impl OrchestrationHooks for Recorder {
    fn issue_credential(&self, chat_id: &str, session_id: &str) -> Option<OrchestrationMcpLaunch> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("issue {chat_id} {session_id}"));
        Some(OrchestrationMcpLaunch {
            url: "http://127.0.0.1:1/mcp".into(),
            token: SecretToken::new("t".into()),
        })
    }
    fn revoke_credential(&self, chat_id: &str) {
        self.calls.lock().unwrap().push(format!("revoke {chat_id}"));
    }
    fn on_chat_stopping<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            self.calls.lock().unwrap().push(format!("stop {chat_id}"));
        })
    }
    fn agent_outbox(&self, chat_id: &str) -> Vec<AgentOutboxEntry> {
        vec![AgentOutboxEntry {
            entry_id: "ob1".into(),
            from_chat_id: chat_id.into(),
            preview: "hi".into(),
        }]
    }
}

#[tokio::test]
async fn an_empty_slot_is_inert_and_an_attached_one_forwards() {
    let slot = OrchestrationSlot::default();
    assert!(slot.issue("c", "s").is_none());
    assert!(slot.agent_outbox("c").is_empty());
    slot.revoke("c");
    slot.stopping("c").await;

    let recorder = Arc::new(Recorder::default());
    slot.attach(recorder.clone());
    assert!(slot.issue("c", "s").is_some());
    assert_eq!(slot.agent_outbox("c")[0].entry_id, "ob1");
    slot.revoke("c");
    slot.stopping("c").await;
    let calls = recorder.calls.lock().unwrap().clone();
    assert_eq!(calls, vec!["issue c s", "revoke c", "stop c"]);
}
