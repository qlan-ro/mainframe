//! The orchestration fields every enriched `Chat` carries: the parent's
//! waiting state over its delegated children, the agent outbox from the
//! attached hooks, and the lineage refresh into a loaded cell.
use super::*;

use mainframe_types::orchestration::{AgentOutboxEntry, OrchestrationMcpLaunch};

use crate::orchestration_hooks::OrchestrationHooks;

fn chat(id: &str) -> Chat {
    // `enrich_chat` stats StoreDeps's fixed project path; keep it present.
    std::fs::create_dir_all("/tmp/test").expect("create the fake project dir");
    let mut c = test_chat(id);
    c.status = ChatStatus::Active;
    c
}

fn gate(request_id: &str) -> mainframe_types::adapter::ControlRequest {
    mainframe_types::adapter::ControlRequest {
        request_id: request_id.to_string(),
        tool_name: "Bash".to_string(),
        tool_use_id: "tu-1".to_string(),
        input: HashMap::new(),
        suggestions: Vec::new(),
        decision_reason: None,
        options: None,
    }
}

struct OutboxHooks;

impl OrchestrationHooks for OutboxHooks {
    fn issue_credential(
        &self,
        _chat_id: &str,
        _session_id: &str,
    ) -> Option<OrchestrationMcpLaunch> {
        None
    }
    fn revoke_credential(&self, _chat_id: &str) {}
    fn on_chat_stopping<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async {})
    }
    fn agent_outbox(&self, chat_id: &str) -> Vec<AgentOutboxEntry> {
        if chat_id != "target" {
            return Vec::new();
        }
        vec![AgentOutboxEntry {
            entry_id: "ob1".into(),
            from_chat_id: "sender".into(),
            preview: "after this turn".into(),
        }]
    }
}

#[tokio::test]
async fn delegated_waiting_follows_a_gate_on_an_unfinished_child() {
    let mut parent = chat("parent");
    parent.orchestration.active_child_ids = vec!["kid".into()];
    let deps = StoreDeps::with_chats(vec![parent, chat("plain")]);
    let mgr = ChatManager::new(deps);

    assert_eq!(
        mgr.get_chat("parent")
            .unwrap()
            .orchestration
            .delegated_waiting,
        Some(false)
    );
    assert_eq!(
        mgr.get_chat("plain")
            .unwrap()
            .orchestration
            .delegated_waiting,
        None
    );

    mgr.permissions
        .lock()
        .unwrap()
        .enqueue("kid", gate("req-1"));

    let waiting = mgr.get_chat("parent").unwrap();
    assert_eq!(waiting.orchestration.delegated_waiting, Some(true));
    // The child's gate never becomes the parent's own pending state.
    assert_ne!(waiting.display_status, Some(DisplayStatus::Waiting));
    let listed = mgr.list_all_chats();
    let parent_row = listed.iter().find(|c| c.id == "parent").unwrap();
    assert_eq!(parent_row.orchestration.delegated_waiting, Some(true));
}

#[tokio::test]
async fn the_agent_outbox_comes_from_the_attached_hooks_on_reads_and_emits() {
    let deps = StoreDeps::with_chats(vec![chat("target"), chat("other")]);
    let mgr = ChatManager::new(deps.clone());
    assert_eq!(
        mgr.get_chat("target").unwrap().orchestration.agent_outbox,
        None
    );

    mgr.set_orchestration_hooks(Arc::new(OutboxHooks));

    let held = mgr.get_chat("target").unwrap().orchestration.agent_outbox;
    assert_eq!(
        held.map(|entries| entries[0].entry_id.clone()).as_deref(),
        Some("ob1")
    );
    assert_eq!(
        mgr.get_chat("other").unwrap().orchestration.agent_outbox,
        None
    );

    mgr.emit_chat_updated("target");
    let emitted = deps.events().into_iter().find_map(|event| match event {
        DaemonEvent::ChatUpdated { chat, .. } if chat.id == "target" => Some(chat),
        _ => None,
    });
    assert!(emitted.unwrap().orchestration.agent_outbox.is_some());
}

#[tokio::test]
async fn refresh_agent_lineage_rereads_the_row_and_announces_the_chat() {
    let deps = StoreDeps::with_chats(vec![chat("c1")]);
    let mgr = ChatManager::new(deps.clone());
    // A loaded cell, which `get_chat` prefers over the row.
    mgr.active_chats.insert(
        "c1".to_string(),
        Arc::new(Mutex::new(ActiveChat::new(chat("c1"), None))),
    );
    {
        let mut store = deps.store.lock().unwrap();
        let row = store.get_mut("c1").unwrap();
        row.orchestration.created_by_chat_id = Some("boss".into());
        row.parent_chat_id = Some(Some("boss".into()));
    }
    assert_eq!(
        mgr.get_chat("c1").unwrap().orchestration.created_by_chat_id,
        None
    );

    mgr.refresh_agent_lineage("c1");

    let chat = mgr.get_chat("c1").unwrap();
    assert_eq!(
        chat.orchestration.created_by_chat_id.as_deref(),
        Some("boss")
    );
    assert_eq!(chat.parent_chat_id, Some(Some("boss".into())));
    assert!(deps.events().iter().any(|event| matches!(
        event,
        DaemonEvent::ChatUpdated { chat, .. } if chat.id == "c1"
    )));
}
