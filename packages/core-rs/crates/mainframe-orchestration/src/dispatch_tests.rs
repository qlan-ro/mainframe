use std::sync::Arc;

use mainframe_types::orchestration::{TaskDelivery, TaskStatus};
use serde_json::json;

use super::*;
use crate::test_fixture::{Fixture, delegate, finish, fixture};
use crate::test_support::announce;

fn call(name: &str, arguments: Value) -> Vec<u8> {
    json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": { "name": name, "arguments": arguments }
    })
    .to_string()
    .into_bytes()
}

/// Lets the other tasks run until `done`.
async fn eventually(done: impl Fn() -> bool) {
    for _ in 0..1_000 {
        if done() {
            return;
        }
        tokio::task::yield_now().await;
    }
    panic!("never happened");
}

/// Sends `body` on its own task, as the HTTP server does.
fn post(f: &Fixture, body: Vec<u8>) -> tokio::task::JoinHandle<RpcReply> {
    let svc = Arc::clone(&f.svc);
    let caller = f.ctx.caller.clone();
    tokio::spawn(async move { svc.handle(&caller, &body).await })
}

#[tokio::test]
async fn unknown_tools_are_protocol_errors_and_tool_failures_are_results() {
    let f = fixture();
    let RpcReply::Response(unknown) = f.svc.handle(&f.ctx.caller, &call("nope", json!({}))).await
    else {
        panic!("expected a response");
    };
    assert_eq!(unknown["error"]["code"], error_codes::INVALID_PARAMS);
    let body = call("chat_read", json!({ "chatId": "missing" }));
    let RpcReply::Response(failed) = f.svc.handle(&f.ctx.caller, &body).await else {
        panic!("expected a response");
    };
    assert_eq!(failed["result"]["isError"], true);
}

/// The HTTP server drops a request's future when its client disconnects. A
/// delegation dropped between launching the child and recording the task would
/// leave a child chat nothing knows about.
#[tokio::test]
async fn a_client_that_disconnects_mid_delegation_still_gets_its_task_recorded() {
    let f = fixture();
    let entered = Arc::new(tokio::sync::Notify::new());
    let resume = Arc::new(tokio::sync::Notify::new());
    f.port.lock().before_send = Some(Arc::new({
        let (entered, resume) = (Arc::clone(&entered), Arc::clone(&resume));
        move || {
            let (entered, resume) = (Arc::clone(&entered), Arc::clone(&resume));
            Box::pin(async move {
                entered.notify_one();
                resume.notified().await;
            })
        }
    }));
    let request = post(&f, call("delegate_task", json!({ "task": "t" })));
    entered.notified().await;
    request.abort();
    assert!(request.await.unwrap_err().is_cancelled());
    resume.notify_one();
    eventually(|| f.tasks.all()[0].status == TaskStatus::Running).await;
}

/// A result nobody is left to read must stay owed, so it arrives as a message.
#[tokio::test]
async fn a_wait_whose_client_disconnected_does_not_acknowledge_the_result() {
    let f = fixture();
    let out = delegate(&f, &f.ctx, "t").await;
    let child = out["childChatId"].as_str().unwrap().to_string();
    let task_id = out["taskId"].as_str().unwrap().to_string();
    let subscribers = f.port.subscribers();
    let request = post(
        &f,
        call(
            "task_status",
            json!({ "taskId": task_id, "waitMs": 40_000 }),
        ),
    );
    eventually(|| f.port.subscribers() > subscribers).await;
    request.abort();
    assert!(request.await.unwrap_err().is_cancelled());
    eventually(|| f.port.subscribers() == subscribers).await;
    finish(&f, &child, "answer").await;
    assert_eq!(f.tasks.find(&task_id).unwrap().delivery, TaskDelivery::Owed);
    f.port.update("parent", |c| c.working = false);
    announce(&f.svc, "parent").await;
    let (to, body) = f.port.lock().sent.last().cloned().unwrap();
    assert_eq!(to, "parent");
    assert!(body.contains("answer"));
}
