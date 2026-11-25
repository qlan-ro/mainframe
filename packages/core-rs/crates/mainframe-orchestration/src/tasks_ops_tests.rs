use std::sync::Arc;

use mainframe_types::orchestration::TaskStatus;
use serde_json::json;

use crate::errors::ErrorCode;
use crate::test_fixture::{delegated, finish, fixture};
use crate::test_support::call_ctx;
use crate::tools::Tool;

/// The sweep below a task happens after the task itself is stopping: its agent
/// may still be running and must not delegate behind the sweep.
#[tokio::test]
async fn a_task_being_cancelled_can_no_longer_delegate() {
    let f = fixture();
    let task = delegated(&f).await;
    let child_ctx = call_ctx(&f.svc, &task.child_chat_id);
    f.svc.begin_stop(&task.child_chat_id).await;
    let args = json!({ "task": "behind the sweep" });
    let err = Tool::DelegateTask
        .run(&f.svc, &child_ctx, args)
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::CallerNotActive);
}

/// The child's own idle event may arrive while the cancel is under way.
#[tokio::test]
async fn a_task_is_cancelled_before_its_child_is_interrupted() {
    let f = fixture();
    let task = delegated(&f).await;
    f.port.lock().before_interrupt = Some(Arc::new({
        let tasks = f.tasks.clone();
        move || {
            let task = tasks.all().remove(0);
            assert_eq!(task.status, TaskStatus::Cancelled);
        }
    }));
    assert_eq!(f.svc.cancel_task(task, None).await.len(), 1);
    assert_eq!(f.port.lock().interrupted.len(), 1);
}

#[tokio::test]
async fn a_cancel_that_returns_a_finished_result_acknowledges_it() {
    let f = fixture();
    let task = delegated(&f).await;
    finish(&f, &task.child_chat_id, "answer").await;
    let args = json!({ "taskId": task.id });
    let out = Tool::TaskCancel.run(&f.svc, &f.ctx, args).await.unwrap();
    assert_eq!(out["summary"], "answer");
    assert!(!f.svc.outbox.has_for("parent"));
}
