//! A parent chat mid-turn, ready to delegate, for the task tests.

use std::sync::Arc;

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent};
use mainframe_types::content::LeafContent;
use mainframe_types::orchestration::DelegatedTask;
use mainframe_types::settings::ExecutionMode;
use serde_json::{Value, json};

use crate::calls::CallCtx;
use crate::service::OrchestrationService;
use crate::test_support::{FakePort, announce, service_with_tasks};
use crate::test_tasks::FakeTasks;
use crate::tools::Tool;

pub(crate) struct Fixture {
    pub svc: Arc<OrchestrationService>,
    pub ctx: CallCtx,
    pub port: FakePort,
    pub tasks: FakeTasks,
}

pub(crate) fn fixture() -> Fixture {
    let port = FakePort::new();
    let mut parent = port.add_chat("parent");
    parent.working = true;
    parent.permission_mode = ExecutionMode::AcceptEdits;
    port.put(parent);
    let tasks = FakeTasks::default();
    let (svc, ctx) = service_with_tasks(port.clone(), tasks.clone(), "parent");
    Fixture {
        svc,
        ctx,
        port,
        tasks,
    }
}

/// Makes `chat_id` finish its turn with `text` as its answer.
pub(crate) async fn finish(f: &Fixture, chat_id: &str, text: &str) {
    let answer = ChatMessage {
        id: format!("{chat_id}-answer"),
        chat_id: chat_id.into(),
        r#type: ChatMessageType::Assistant,
        content: vec![MessageContent::Leaf(LeafContent::Text {
            text: text.into(),
            parent_tool_use_id: None,
        })],
        timestamp: "t".into(),
        metadata: None,
    };
    f.port
        .lock()
        .messages
        .entry(chat_id.into())
        .or_default()
        .push(answer);
    f.port.update(chat_id, |c| c.working = false);
    announce(&f.svc, chat_id).await;
}

pub(crate) async fn delegate(f: &Fixture, ctx: &CallCtx, task: &str) -> Value {
    Tool::DelegateTask
        .run(&f.svc, ctx, json!({ "task": task }))
        .await
        .unwrap()
}

/// Delegates one task from the parent and returns it.
pub(crate) async fn delegated(f: &Fixture) -> DelegatedTask {
    delegate(f, &f.ctx, "t").await;
    f.tasks.all().remove(0)
}
