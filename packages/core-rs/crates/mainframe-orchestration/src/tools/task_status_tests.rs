use mainframe_types::events::DaemonEvent;
use mainframe_types::orchestration::{TaskDelivery, TaskStatus};
use serde_json::json;

use super::*;
use crate::input::golden::{fixture_keys, schema_properties};
use crate::test_support::{call_ctx, wire_chat};
use crate::tools::delegate_task::tests::{delegate, finish, fixture};

#[test]
fn schemas_match_the_input_structs() {
    let status = json!({ "taskId": "t", "waitMs": 0 });
    assert_eq!(
        schema_properties(&status_definition().input_schema),
        fixture_keys(&status)
    );
    assert!(parse_args::<StatusInput>(status).is_ok());
    assert!(parse_args::<StatusInput>(json!({ "waitMs": 5 })).is_err());
    let cancel = json!({ "taskId": "t", "reason": "r" });
    assert_eq!(
        schema_properties(&cancel_definition().input_schema),
        fixture_keys(&cancel)
    );
    assert!(parse_args::<CancelInput>(cancel).is_ok());
    assert!(parse_args::<CancelInput>(json!({})).is_err());
}

#[tokio::test]
async fn reading_a_finished_task_acknowledges_its_delivery() {
    let f = fixture();
    let out = delegate(&f, &f.ctx, "t").await;
    let (task_id, child) = (
        out["taskId"].as_str().unwrap().to_string(),
        out["childChatId"].as_str().unwrap().to_string(),
    );
    finish(&f, &child, "the answer").await;
    let read = run_status(&f.svc, &f.ctx, json!({ "taskId": task_id }))
        .await
        .unwrap();
    assert_eq!(read["status"], "completed");
    assert_eq!(read["summary"], "the answer");
    assert_eq!(read["workState"], "result_available");
    assert_eq!(
        f.tasks.find(&task_id).unwrap().delivery,
        TaskDelivery::Acknowledged
    );

    let prompts = f.port.lock().sent.len();
    f.port.update("parent", |c| c.working = false);
    f.svc
        .on_event(&DaemonEvent::ChatUpdated {
            chat: wire_chat("parent"),
            reason: None,
        })
        .await;
    assert_eq!(
        f.port.lock().sent.len(),
        prompts,
        "an acknowledged result is not sent again"
    );

    let listed = run_status(&f.svc, &f.ctx, json!({})).await.unwrap();
    assert_eq!(listed["tasks"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn another_parents_task_is_not_found() {
    let f = fixture();
    let task_id = delegate(&f, &f.ctx, "t").await["taskId"]
        .as_str()
        .unwrap()
        .to_string();
    f.port.add_chat("stranger");
    let stranger = call_ctx(&f.svc, "stranger");
    let err = run_status(&f.svc, &stranger, json!({ "taskId": task_id }))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::TaskNotFound);
}

#[tokio::test]
async fn cancel_stops_descendants_first_and_drops_their_deliveries() {
    let f = fixture();
    let out = delegate(&f, &f.ctx, "lead").await;
    let (task_id, child) = (
        out["taskId"].as_str().unwrap().to_string(),
        out["childChatId"].as_str().unwrap().to_string(),
    );
    let child_ctx = call_ctx(&f.svc, &child);
    let grand = delegate(&f, &child_ctx, "sub").await;
    let grand_task = grand["taskId"].as_str().unwrap().to_string();
    let grand_chat = grand["childChatId"].as_str().unwrap().to_string();

    let out = run_cancel(
        &f.svc,
        &f.ctx,
        json!({ "taskId": task_id, "reason": "enough" }),
    )
    .await
    .unwrap();
    assert_eq!(out["status"], "cancelled");
    assert_eq!(out["cancelledDescendantTaskIds"], json!([grand_task]));
    let interrupted = f.port.lock().interrupted.clone();
    assert_eq!(interrupted, vec![grand_chat, child.clone()]);
    for id in [&task_id, &grand_task] {
        let task = f.tasks.find(id).unwrap();
        assert_eq!(task.status, TaskStatus::Cancelled);
        assert_eq!(task.delivery, TaskDelivery::Dropped);
    }
    assert_eq!(
        f.tasks.find(&task_id).unwrap().cancel_reason.as_deref(),
        Some("enough")
    );
    assert!(!f.svc.outbox.has_for("parent") && !f.svc.outbox.has_for(&child));
}

#[tokio::test]
async fn a_stop_cascades_and_rejects_a_late_call_from_the_stopped_turn() {
    let f = fixture();
    let child = delegate(&f, &f.ctx, "t").await["childChatId"]
        .as_str()
        .unwrap()
        .to_string();
    let cancelled = f.svc.cascade_stop("parent", None).await;
    assert_eq!(cancelled.len(), 1);
    assert!(f.port.lock().interrupted.contains(&child));
    let late = call_ctx(&f.svc, "parent");
    let err = crate::tools::delegate_task::run(&f.svc, &late, json!({ "task": "again" }))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::CallerNotActive);
}
