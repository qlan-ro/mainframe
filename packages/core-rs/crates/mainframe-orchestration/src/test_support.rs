//! Chats, services, and call contexts for the tool tests.

use std::sync::Arc;

use mainframe_types::chat::{Chat, ChatStatus};
use mainframe_types::events::DaemonEvent;
use mainframe_types::settings::ExecutionMode;
use serde_json::json;

use crate::calls::CallCtx;
use crate::ports::ChatView;
use crate::service::OrchestrationService;
pub(crate) use crate::test_port::FakePort;
use crate::test_tasks::FakeTasks;

pub fn chat_view(id: &str) -> ChatView {
    ChatView {
        id: id.into(),
        project_id: "p".into(),
        title: Some(format!("Chat {id}")),
        adapter_id: "claude".into(),
        model: Some("default".into()),
        permission_mode: ExecutionMode::Default,
        plan_mode: false,
        status: ChatStatus::Active,
        working: false,
        pending_permission: None,
        temporary: false,
        automation: false,
        parent_chat_id: None,
        created_by_chat_id: None,
        task_id: None,
        worktree_path: None,
        branch_name: None,
        created_at: "2026-10-06T00:00:00.000Z".into(),
        updated_at: "2026-10-06T00:00:00.000Z".into(),
    }
}

/// A minimal wire `Chat` for `chat.updated` events in tests.
pub(crate) fn wire_chat(id: &str) -> Chat {
    let value = json!({
        "id": id, "adapterId": "claude", "projectId": "p", "status": "active",
        "createdAt": "", "updatedAt": "", "totalCost": 0.0,
        "totalTokensInput": 0, "totalTokensOutput": 0, "lastContextTokensInput": 0
    });
    serde_json::from_value(value).unwrap_or_else(|e| panic!("wire chat: {e}"))
}

/// A service over `port` and a live call context for `caller_chat_id`.
pub(crate) fn service_with(
    port: FakePort,
    caller_chat_id: &str,
) -> (Arc<OrchestrationService>, CallCtx) {
    service_with_tasks(port, FakeTasks::default(), caller_chat_id)
}

pub(crate) fn service_with_tasks(
    port: FakePort,
    tasks: FakeTasks,
    caller_chat_id: &str,
) -> (Arc<OrchestrationService>, CallCtx) {
    let svc = Arc::new(OrchestrationService::new(
        Arc::new(port),
        Arc::new(tasks),
        "test",
        1,
    ));
    let ctx = call_ctx(&svc, caller_chat_id);
    (svc, ctx)
}

/// A live call context for another chat on the same service.
pub(crate) fn call_ctx(svc: &OrchestrationService, chat_id: &str) -> CallCtx {
    let token = svc
        .issue_launch(chat_id, &format!("session-{chat_id}"))
        .token;
    let caller = svc
        .credentials()
        .resolve(token.expose())
        .unwrap_or_else(|| panic!("caller"));
    CallCtx::begin(&caller, "n:1".into())
}

/// Delivers a plain `chat.updated` for `chat_id` to the service.
pub(crate) async fn announce(svc: &OrchestrationService, chat_id: &str) {
    svc.on_event(&DaemonEvent::ChatUpdated {
        chat: wire_chat(chat_id),
        reason: None,
    })
    .await;
}
