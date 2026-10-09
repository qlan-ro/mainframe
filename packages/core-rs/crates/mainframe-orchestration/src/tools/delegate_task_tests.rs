use std::sync::Arc;

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent};
use mainframe_types::content::LeafContent;
use mainframe_types::orchestration::{TaskDelivery, TaskStatus};
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

/// A child interrupted directly (its own Stop, not a cascade from the
/// parent) still owes the parent a delivery: the reactive event-loop path
/// (`lifecycle.rs::on_event`) must finalize the task as `interrupted`, not
/// leave it open forever, and `finalize` must still queue it (delivery is
/// only ever dropped for a `cancelled` task, one the parent asked for
/// itself). An async-waiting parent that never polls must still receive it
/// once idle, the same as any other outcome.
#[tokio::test]
async fn a_directly_interrupted_child_still_delivers_to_an_async_waiting_parent() {
    let f = fixture();
    let child = delegate(&f, &f.ctx, "a").await["childChatId"]
        .as_str()
        .unwrap()
        .to_string();
    // The child's own Stop: its turn ends with no trailing error, which the
    // idle_outcome alone would read as "completed" — only the `Interrupted`
    // reason distinguishes it.
    f.port.update(&child, |c| c.working = false);
    f.svc
        .on_event(&DaemonEvent::ChatUpdated {
            chat: crate::test_support::wire_chat(&child),
            reason: Some(mainframe_types::events::ChatUpdatedReason::Interrupted),
        })
        .await;

    let task = f.tasks.all().into_iter().next().unwrap();
    assert_eq!(task.status, TaskStatus::Interrupted);
    assert_eq!(task.delivery, TaskDelivery::Owed);

    f.port.update("parent", |c| c.working = false);
    f.svc
        .on_event(&DaemonEvent::ChatUpdated {
            chat: crate::test_support::wire_chat("parent"),
            reason: None,
        })
        .await;
    let (to, body) = f.port.lock().sent.last().unwrap().clone();
    assert_eq!(to, "parent");
    assert!(body.contains("status=\"interrupted\""), "{body}");
    assert_eq!(
        f.tasks.all()[0].delivery,
        TaskDelivery::Delivered,
        "an interrupted task must still be delivered, not dropped"
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

/// Concurrent calls with the same `clientRequestId` must create exactly one
/// task: the idempotency check and the insert run under one lock
/// (`OrchestrationService::tree_lock`), so a second caller that raced past
/// the first's check (widened by `FakePort::launch_chat`'s deliberate
/// `yield_now`) still finds the first's row once it is its own turn.
#[tokio::test]
async fn concurrent_calls_with_the_same_request_id_create_exactly_one_task() {
    let f = fixture();
    let call = |n: u32| {
        run(
            &f.svc,
            &f.ctx,
            json!({ "task": format!("t{n}"), "clientRequestId": "k1" }),
        )
    };
    let (a, b, c, d) = tokio::join!(call(0), call(1), call(2), call(3));
    let ids: std::collections::HashSet<String> = [a, b, c, d]
        .into_iter()
        .map(|r| r.unwrap()["taskId"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(ids.len(), 1, "every caller must see the same task id");
    assert_eq!(f.tasks.all().len(), 1, "exactly one task row was inserted");
}

/// Concurrent calls must not together exceed `MAX_ACTIVE_TASKS_PER_PARENT`,
/// even though each one's own limit check, taken alone, would have allowed
/// it (the count it read did not yet include the others' in-flight inserts).
#[tokio::test]
async fn concurrent_calls_cannot_together_exceed_the_per_parent_limit() {
    let f = fixture();
    let call = |n: u32| run(&f.svc, &f.ctx, json!({ "task": format!("t{n}") }));
    let (a, b, c, d, e, g) = tokio::join!(call(0), call(1), call(2), call(3), call(4), call(5));
    let outcomes = [a, b, c, d, e, g];
    let ok = outcomes.iter().filter(|r| r.is_ok()).count();
    let limited = outcomes
        .iter()
        .filter(|r| {
            r.as_ref()
                .err()
                .is_some_and(|e| e.code == ErrorCode::TaskLimitExceeded)
        })
        .count();
    assert_eq!(ok, crate::policy::MAX_ACTIVE_TASKS_PER_PARENT);
    assert_eq!(ok + limited, outcomes.len());
    assert_eq!(
        f.tasks.all().len(),
        crate::policy::MAX_ACTIVE_TASKS_PER_PARENT
    );
}

/// A Stop that lands while a call is queued for the tree lock (another
/// delegation from the same tree is mid-launch) must not let the queued
/// call's task and child outlive it: the cascade's own sweep only cancels
/// tasks that existed when it ran, so a task inserted after that point
/// would otherwise keep running. `run` re-checks the caller right after
/// acquiring the lock and must refuse (and leave nothing non-terminal)
/// once the Stop has landed.
#[tokio::test]
async fn a_stop_that_lands_while_queued_for_the_tree_lock_cancels_nothing_new() {
    let f = fixture();
    let root = f.svc.tree_root(&f.ctx.caller.chat_id).await;
    let lock = f.svc.tree_lock(&root);
    let guard = lock.clone().lock_owned().await;

    // Simulates call A holding the lock during its own launch_chat: while
    // this call (B, below) queues for the lock, the user stops the parent,
    // then A's hold on the lock ends.
    let svc = f.svc.clone();
    let port = f.port.clone();
    let caller_id = f.ctx.caller.chat_id.clone();
    tokio::spawn(async move {
        tokio::task::yield_now().await;
        svc.mark_stopping(&caller_id);
        port.update(&caller_id, |c| c.working = false);
        drop(guard);
    });

    let err = run(&f.svc, &f.ctx, json!({ "task": "t" }))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::CallerNotActive);
    assert!(
        f.tasks.all().iter().all(|t| t.status.is_terminal()),
        "no task may be left running past the Stop"
    );
}

/// The same race one level further in: a Stop lands after `launch_chat`
/// has created the child but before the task row and its delivery are
/// settled. The new task and its child must be cancelled, not merely
/// refused. `FakePort::after_launch` lands the Stop deterministically
/// right after the child exists, in place of racing two tasks for a
/// window FakePort's own methods complete without yielding across.
#[tokio::test]
async fn a_stop_that_lands_after_the_child_is_launched_cancels_the_new_task() {
    let f = fixture();
    let svc = f.svc.clone();
    let port = f.port.clone();
    let caller_id = f.ctx.caller.chat_id.clone();
    f.port.lock().after_launch = Some(Arc::new(move || {
        svc.mark_stopping(&caller_id);
        port.update(&caller_id, |c| c.working = false);
    }));

    let err = run(&f.svc, &f.ctx, json!({ "task": "t" }))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::CallerNotActive);
    let tasks = f.tasks.all();
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].status, TaskStatus::Cancelled);
    assert_eq!(tasks[0].delivery, TaskDelivery::Dropped);
    assert_eq!(
        f.port.lock().interrupted,
        vec![tasks[0].child_chat_id.clone()]
    );
}
