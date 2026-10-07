use std::sync::Arc;

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent};
use mainframe_types::content::LeafContent;
use mainframe_types::orchestration::TaskDelivery;
use serde_json::json;

use super::*;
use crate::errors::ErrorCode;
use crate::input::golden::{fixture_keys, schema_properties};
use crate::ports::PendingPermissionView;
use crate::test_support::{FakePort, call_ctx, service_with_tasks};
use crate::test_tasks::FakeTasks;

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
    f.svc
        .on_event(&DaemonEvent::ChatUpdated {
            chat: crate::test_support::wire_chat(chat_id),
            reason: None,
        })
        .await;
}

pub(crate) async fn delegate(f: &Fixture, ctx: &CallCtx, task: &str) -> Value {
    run(&f.svc, ctx, json!({ "task": task })).await.unwrap()
}

use mainframe_types::events::DaemonEvent;

#[test]
fn schema_matches_the_input_struct() {
    let accept = json!({
        "task": "t", "title": "x", "role": "review", "adapterId": "claude", "model": "default",
        "permissionMode": "default", "planMode": true, "workspace": { "mode": "inherit" },
        "mode": "wait", "timeoutMs": 1000, "clientRequestId": "k1"
    });
    assert_eq!(
        schema_properties(&definition().input_schema),
        fixture_keys(&accept)
    );
    assert!(parse_args::<Input>(accept).is_ok());
    assert!(parse_args::<Input>(json!({})).is_err());
    assert!(parse_args::<Input>(json!({ "task": "t", "role": "boss" })).is_err());
    assert!(
        parse_args::<Input>(json!({ "task": "t", "workspace": { "mode": "project_root" } }))
            .is_err()
    );
}

#[tokio::test]
async fn async_delegation_creates_a_nested_child_with_only_the_task_prompt() {
    let f = fixture();
    let out = delegate(&f, &f.ctx, "Review the diff").await;
    assert_eq!(out["status"], "running");
    assert_eq!(out["permissionMode"], "acceptEdits");
    let child = out["childChatId"].as_str().unwrap().to_string();
    let request = f.port.lock().launched[0].clone();
    assert_eq!(request.parent_chat_id.as_deref(), Some("parent"));
    assert_eq!(request.title.as_deref(), Some("Task: Review the diff"));
    let (to, body) = f.port.lock().sent[0].clone();
    assert_eq!(to, child);
    assert!(body.starts_with("<mainframe-agent-message from=\"parent\" kind=\"task\">"));
    assert!(body.contains("Review the diff"));
    assert_eq!(f.tasks.all()[0].depth, 1);
    // Both chats re-announce, so the child row and the parent's waiting
    // state follow the task.
    let changed = f.port.lock().changed.clone();
    assert!(changed.contains(&"parent".to_string()));
    assert!(changed.contains(&child));
}

#[tokio::test]
async fn a_retry_with_the_same_key_returns_the_existing_task() {
    let f = fixture();
    let args = json!({ "task": "t", "clientRequestId": "k1" });
    let first = run(&f.svc, &f.ctx, args.clone()).await.unwrap();
    let second = run(&f.svc, &f.ctx, args).await.unwrap();
    assert_eq!(first["taskId"], second["taskId"]);
    assert_eq!(f.port.lock().launched.len(), 1);
}

#[tokio::test]
async fn sibling_results_are_held_until_the_parent_is_idle_then_batched() {
    let f = fixture();
    let a = delegate(&f, &f.ctx, "a").await["childChatId"]
        .as_str()
        .unwrap()
        .to_string();
    let b = delegate(&f, &f.ctx, "b").await["childChatId"]
        .as_str()
        .unwrap()
        .to_string();
    finish(&f, &a, "answer A").await;
    finish(&f, &b, "answer B").await;
    assert_eq!(
        f.port.lock().sent.len(),
        2,
        "only the two task prompts so far"
    );
    assert!(
        f.tasks
            .all()
            .iter()
            .all(|t| t.delivery == TaskDelivery::Owed)
    );

    f.port.update("parent", |c| c.working = false);
    f.svc
        .on_event(&DaemonEvent::ChatUpdated {
            chat: crate::test_support::wire_chat("parent"),
            reason: None,
        })
        .await;
    let (to, body) = f.port.lock().sent[2].clone();
    assert_eq!(to, "parent");
    assert!(body.contains("answer A") && body.contains("answer B"));
    assert_eq!(body.matches("<mainframe-task-result").count(), 2);
    assert!(
        f.tasks
            .all()
            .iter()
            .all(|t| t.delivery == TaskDelivery::Delivered)
    );
}

#[tokio::test]
async fn a_child_with_open_subtasks_waits_for_their_results() {
    let f = fixture();
    let child = delegate(&f, &f.ctx, "lead").await["childChatId"]
        .as_str()
        .unwrap()
        .to_string();
    let child_ctx = call_ctx(&f.svc, &child);
    let grandchild = delegate(&f, &child_ctx, "sub").await["childChatId"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        f.tasks.find(&format!("task_{grandchild}")).unwrap().depth,
        2
    );

    finish(&f, &child, "partial").await;
    let task_id = format!("task_{child}");
    assert_eq!(f.tasks.find(&task_id).unwrap().status, TaskStatus::Running);
    let view = f
        .svc
        .task_result(&f.tasks.find(&task_id).unwrap(), None)
        .await;
    assert_eq!(view["workState"], "waiting_for_children");

    finish(&f, &grandchild, "sub done").await;
    let (to, body) = f.port.lock().sent.last().cloned().unwrap();
    assert_eq!(to, child, "the grandchild's result goes to the child");
    assert!(body.contains("sub done"));
    finish(&f, &child, "all done").await;
    let task = f.tasks.find(&task_id).unwrap();
    assert_eq!(task.status, TaskStatus::Completed);
    assert_eq!(task.summary.as_deref(), Some("all done"));
}

#[tokio::test(start_paused = true)]
async fn wait_mode_returns_when_the_child_needs_a_permission_answer() {
    let f = fixture();
    let f = Arc::new(f);
    let waiter = {
        let f = Arc::clone(&f);
        tokio::spawn(async move {
            let ctx = call_ctx(&f.svc, "parent");
            run(&f.svc, &ctx, json!({ "task": "t", "mode": "wait" })).await
        })
    };
    while f.port.lock().launched.is_empty() {
        tokio::task::yield_now().await;
    }
    let child = format!("launched{}", f.port.lock().launched.len());
    f.port.update(&child, |c| {
        c.pending_permission = Some(PendingPermissionView {
            tool_name: "Bash".into(),
            summary: String::new(),
        });
    });
    f.port.touch(&child);
    let out = waiter.await.unwrap().unwrap();
    assert_eq!(out["waitReturned"], "waiting_for_permission");
    assert_eq!(out["status"], "waiting");
}

#[tokio::test]
async fn limits_and_ceilings_hold() {
    let f = fixture();
    let err = run(
        &f.svc,
        &f.ctx,
        json!({ "task": "t", "permissionMode": "yolo" }),
    )
    .await
    .unwrap_err();
    assert_eq!(err.code, ErrorCode::PermissionModeEscalationDenied);
    for i in 0..crate::policy::MAX_ACTIVE_TASKS_PER_PARENT {
        delegate(&f, &f.ctx, &format!("t{i}")).await;
    }
    let err = run(&f.svc, &f.ctx, json!({ "task": "one more" }))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::TaskLimitExceeded);
}
