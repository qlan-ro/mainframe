use std::sync::Arc;
use std::sync::atomic::Ordering;

use mainframe_types::events::ChatUpdatedReason;
use serde_json::json;

use super::*;
use crate::calls::CallCtx;
use crate::test_fixture::{Fixture, delegate, delegated, finish, fixture};
use crate::test_support::{announce, call_ctx, wire_chat};
use crate::tools::Tool;

fn status_of(f: &Fixture, id: &str) -> TaskStatus {
    f.tasks.find(id).unwrap().status
}

fn interrupted_event(chat_id: &str) -> DaemonEvent {
    DaemonEvent::ChatUpdated {
        chat: wire_chat(chat_id),
        reason: Some(ChatUpdatedReason::Interrupted),
    }
}

async fn run(f: &Fixture, ctx: &CallCtx, tool: Tool, args: serde_json::Value) -> serde_json::Value {
    tool.run(&f.svc, ctx, args).await.unwrap()
}

/// Both the event loop and a waiting tool call see the stopped child go idle.
/// Whichever advances the task first must record the Stop.
#[tokio::test]
async fn a_waiter_that_sees_a_stopped_child_first_records_it_as_interrupted() {
    let f = fixture();
    let task = delegated(&f).await;
    f.svc.cascade_stop(&task.child_chat_id, None).await;
    f.port.update(&task.child_chat_id, |c| c.working = false);

    let read = run(&f, &f.ctx, Tool::TaskStatus, json!({ "taskId": task.id })).await;
    assert_eq!(read["status"], "interrupted");
    f.svc
        .on_event(&interrupted_event(&task.child_chat_id))
        .await;
    assert_eq!(status_of(&f, &task.id), TaskStatus::Interrupted);
    assert!(!f.svc.is_stopping(&task.child_chat_id));
}

#[tokio::test]
async fn a_stop_also_records_the_results_it_drops() {
    let f = fixture();
    let task = delegated(&f).await;
    finish(&f, &task.child_chat_id, "answer").await;
    f.svc.cascade_stop("parent", None).await;
    assert!(!f.svc.outbox.has_for("parent"));
    assert_eq!(
        f.tasks.find(&task.id).unwrap().delivery,
        TaskDelivery::Dropped,
        "left owed, the next daemon would deliver it anyway"
    );
}

#[tokio::test]
async fn a_deleted_parent_owes_no_delivery() {
    let f = fixture();
    let task = delegated(&f).await;
    finish(&f, &task.child_chat_id, "answer").await;
    f.port.remove("parent");
    announce(&f.svc, "parent").await;
    assert_eq!(
        f.tasks.find(&task.id).unwrap().delivery,
        TaskDelivery::Dropped
    );
}

/// The user can cancel a task from its card while its prompt is still on its
/// way; the start must not turn it back into a running one.
#[tokio::test]
async fn a_task_cancelled_while_its_prompt_is_sent_stays_cancelled() {
    let f = fixture();
    let (svc, tasks) = (Arc::clone(&f.svc), f.tasks.clone());
    f.port.lock().before_send = Some(Arc::new(move || {
        let (svc, tasks) = (Arc::clone(&svc), tasks.clone());
        Box::pin(async move {
            let id = tasks.all()[0].id.clone();
            assert!(svc.cancel_task_for_parent("parent", &id).await.unwrap());
        })
    }));
    let out = delegate(&f, &f.ctx, "t").await;
    assert_eq!(out["status"], "cancelled");
    let task = f.tasks.all().remove(0);
    assert_eq!(task.status, TaskStatus::Cancelled);
    assert_eq!(f.svc.tracked_task(&task.child_chat_id), None);
    assert_eq!(
        f.port.lock().interrupted.last(),
        Some(&task.child_chat_id),
        "the turn the prompt started is stopped again"
    );
}

#[tokio::test]
async fn a_prompt_that_cannot_be_sent_fails_the_task() {
    let f = fixture();
    f.port.lock().send_fails.insert("launched1".into());
    let out = delegate(&f, &f.ctx, "t").await;
    assert_eq!(out["status"], "failed");
    assert_eq!(f.tasks.all()[0].delivery, TaskDelivery::Owed);
}

#[tokio::test]
async fn a_child_whose_task_cannot_be_recorded_is_retired() {
    let f = fixture();
    f.tasks.fail_writes.store(true, Ordering::SeqCst);
    let args = json!({ "task": "t" });
    assert!(Tool::DelegateTask.run(&f.svc, &f.ctx, args).await.is_err());
    assert_eq!(
        f.port.lock().retired,
        vec![("launched1".to_string(), false)]
    );
    assert!(f.port.lock().sent.is_empty());
}

#[tokio::test]
async fn an_ending_that_cannot_be_saved_is_retried_on_the_next_event() {
    let f = fixture();
    let task = delegated(&f).await;
    f.tasks.fail_writes.store(true, Ordering::SeqCst);
    finish(&f, &task.child_chat_id, "answer").await;
    assert_eq!(status_of(&f, &task.id), TaskStatus::Running);
    assert!(!f.svc.outbox.has_for("parent"));

    f.tasks.fail_writes.store(false, Ordering::SeqCst);
    announce(&f.svc, &task.child_chat_id).await;
    assert_eq!(status_of(&f, &task.id), TaskStatus::Completed);
    assert!(f.svc.outbox.has_for("parent"));
}

/// An unreadable store once read as "no tasks": no limits, no subtasks, and a
/// retry that started its task again.
#[tokio::test]
async fn a_store_that_cannot_be_read_creates_nothing() {
    let f = fixture();
    f.tasks.fail_reads.store(true, Ordering::SeqCst);
    let args = json!({ "task": "t", "clientRequestId": "k1" });
    let err = Tool::DelegateTask
        .run(&f.svc, &f.ctx, args)
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::OrchestrationError);
    assert!(f.port.lock().launched.is_empty());
}

#[tokio::test]
async fn a_retry_that_returns_a_finished_result_acknowledges_it() {
    let f = fixture();
    let args = json!({ "task": "t", "clientRequestId": "k1" });
    let first = run(&f, &f.ctx, Tool::DelegateTask, args.clone()).await;
    finish(&f, first["childChatId"].as_str().unwrap(), "answer").await;
    let retry = run(&f, &f.ctx, Tool::DelegateTask, args).await;
    assert_eq!(retry["summary"], "answer");
    assert_eq!(f.tasks.all()[0].delivery, TaskDelivery::Acknowledged);
    assert!(!f.svc.outbox.has_for("parent"));
}

#[tokio::test]
async fn owed_results_survive_a_restart_but_wake_the_parent_only_after_it_spawns() {
    let f = fixture();
    let task = delegated(&f).await;
    finish(&f, &task.child_chat_id, "answer").await;

    let port = f.port.clone();
    port.update("parent", |c| c.working = false);
    let sent = port.lock().sent.len();
    let restarted = Arc::new(crate::service::OrchestrationService::new(
        Arc::new(port.clone()),
        Arc::new(f.tasks.clone()),
        "test",
        1,
    ));
    restarted.reconcile_boot().await;
    announce(&restarted, "parent").await;
    assert_eq!(port.lock().sent.len(), sent);
    let _launch = restarted.issue_launch("parent", "session");
    announce(&restarted, "parent").await;
    assert_eq!(port.lock().sent.len(), sent + 1);
}

/// A child idle until its subtask reports has nothing else to wake it.
#[tokio::test]
async fn a_task_whose_awaited_result_cannot_be_delivered_fails() {
    let f = fixture();
    let lead = delegated(&f).await;
    let child_ctx = call_ctx(&f.svc, &lead.child_chat_id);
    let sub = delegate(&f, &child_ctx, "sub").await;
    finish(&f, &lead.child_chat_id, "waiting for the subtask").await;
    f.port.lock().send_fails.insert(lead.child_chat_id.clone());
    finish(&f, sub["childChatId"].as_str().unwrap(), "sub done").await;
    let lead = f.tasks.find(&lead.id).unwrap();
    assert_eq!(lead.status, TaskStatus::Failed);
    assert_eq!(lead.delivery, TaskDelivery::Owed);
    assert!(f.svc.outbox.has_for("parent"));
}

#[tokio::test]
async fn an_unreadable_chat_is_not_a_deleted_one() {
    let f = fixture();
    let task = delegated(&f).await;
    finish(&f, &task.child_chat_id, "answer").await;
    f.port.lock().chat_reads_fail = true;
    announce(&f.svc, "parent").await;
    assert_eq!(f.tasks.find(&task.id).unwrap().delivery, TaskDelivery::Owed);
    assert!(f.svc.outbox.has_for("parent"));
}

#[tokio::test]
async fn an_unreadable_child_does_not_fail_its_task() {
    let f = fixture();
    let task = delegated(&f).await;
    f.port.lock().chat_reads_fail = true;
    announce(&f.svc, &task.child_chat_id).await;
    assert_eq!(status_of(&f, &task.id), TaskStatus::Running);
}

/// The result has left the outbox and the child's turn has not started yet:
/// the child looks idle to a waiting parent, but it is not done.
#[tokio::test]
async fn a_task_is_not_finished_while_its_subtasks_result_is_being_delivered() {
    let f = fixture();
    let lead = delegated(&f).await;
    let child_ctx = call_ctx(&f.svc, &lead.child_chat_id);
    let sub = delegate(&f, &child_ctx, "sub").await;
    finish(&f, &lead.child_chat_id, "waiting for the subtask").await;
    let (svc, lead_id) = (Arc::clone(&f.svc), lead.id.clone());
    f.port.lock().before_send = Some(Arc::new(move || {
        let (svc, lead_id) = (Arc::clone(&svc), lead_id.clone());
        Box::pin(async move {
            // Not awaited: ending the task flushes, which waits for this send.
            tokio::spawn(async move { svc.advance(&lead_id, false).await });
            for _ in 0..10 {
                tokio::task::yield_now().await;
            }
        })
    }));
    finish(&f, sub["childChatId"].as_str().unwrap(), "sub done").await;
    assert_eq!(status_of(&f, &lead.id), TaskStatus::Running);
    f.port.lock().before_send = None;
    finish(&f, &lead.child_chat_id, "all done").await;
    assert_eq!(
        f.tasks.find(&lead.id).unwrap().summary.as_deref(),
        Some("all done")
    );
}

#[tokio::test]
async fn a_read_nobody_is_left_to_receive_acknowledges_nothing() {
    let f = fixture();
    let task = delegated(&f).await;
    finish(&f, &task.child_chat_id, "answer").await;
    drop(f.ctx.abandon_on_drop());
    run(&f, &f.ctx, Tool::TaskStatus, json!({ "taskId": task.id })).await;
    assert_eq!(f.tasks.find(&task.id).unwrap().delivery, TaskDelivery::Owed);
    assert!(f.svc.outbox.has_for("parent"));
}
