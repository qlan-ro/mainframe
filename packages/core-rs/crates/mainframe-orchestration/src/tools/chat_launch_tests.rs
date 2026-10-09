use serde_json::json;

use super::*;
use crate::errors::ErrorCode;
use crate::input::golden::{fixture_keys, schema_properties};
use crate::policy::{CREATION_LIMIT, MAX_DEPTH};
use crate::ports::LaunchWorkspace;
use crate::test_support::{FakePort, service_with};

fn working_caller(port: &FakePort, mode: ExecutionMode) {
    let mut caller = port.add_chat("caller");
    caller.working = true;
    caller.permission_mode = mode;
    caller.worktree_path = Some("/wt".into());
    port.put(caller);
}

#[test]
fn schema_matches_the_input_struct() {
    let accept = json!({
        "projectId": "p", "prompt": "go", "title": "t", "adapterId": "claude",
        "model": "default", "permissionMode": "default", "planMode": false,
        "workspace": { "mode": "new_worktree", "baseBranch": "main", "branchName": "feat/x" }
    });
    assert_eq!(
        schema_properties(&definition().input_schema),
        fixture_keys(&accept)
    );
    assert!(parse_args::<Input>(accept).is_ok());
    assert!(parse_args::<Input>(json!({ "prompt": "" })).is_err());
    assert!(parse_args::<Input>(json!({ "permissionMode": "root" })).is_err());
    assert!(parse_args::<Input>(json!({ "workspace": { "mode": "x" } })).is_err());
    assert!(parse_args::<Input>(json!({ "workspace": { "mode": "inherit", "y": 1 } })).is_err());
}

#[tokio::test]
async fn launches_with_caller_defaults_and_wraps_the_prompt() {
    let port = FakePort::new();
    working_caller(&port, ExecutionMode::AcceptEdits);
    let (svc, ctx) = service_with(port.clone(), "caller");
    let out = run(&svc, &ctx, json!({ "prompt": "review it" }))
        .await
        .unwrap();
    assert_eq!(out["promptDelivery"], "started");
    assert_eq!(out["permissionMode"], "acceptEdits");
    let state = port.lock();
    let request = &state.launched[0];
    assert_eq!(request.created_by_chat_id, "caller");
    assert_eq!(request.workspace, LaunchWorkspace::ProjectRoot);
    let (target, body) = &state.sent[0];
    assert_eq!(target, out["chatId"].as_str().unwrap());
    assert!(body.starts_with("<mainframe-agent-message from=\"caller\" kind=\"launch\">"));
}

#[tokio::test]
async fn refuses_escalation_idle_callers_and_bad_adapters() {
    let port = FakePort::new();
    working_caller(&port, ExecutionMode::Default);
    let (svc, ctx) = service_with(port.clone(), "caller");
    let err = run(&svc, &ctx, json!({ "permissionMode": "yolo" }))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::PermissionModeEscalationDenied);
    let err = run(&svc, &ctx, json!({ "adapterId": "nope" }))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::AdapterUnavailable);
    let err = run(&svc, &ctx, json!({ "model": "huge" }))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::ModelUnavailable);
    port.update("caller", |c| c.working = false);
    let err = run(&svc, &ctx, json!({})).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::CallerNotActive);
    assert!(port.lock().launched.is_empty());
}

#[tokio::test]
async fn inherit_shares_the_callers_worktree_and_bad_paths_are_rejected() {
    let port = FakePort::new();
    working_caller(&port, ExecutionMode::Default);
    let (svc, ctx) = service_with(port.clone(), "caller");
    run(&svc, &ctx, json!({ "workspace": { "mode": "inherit" } }))
        .await
        .unwrap();
    let shared = port.lock().launched[0].workspace.clone();
    assert_eq!(
        shared,
        LaunchWorkspace::Shared {
            worktree_path: Some("/wt".into()),
            branch_name: None
        }
    );
    let bad = json!({ "workspace": { "mode": "existing_worktree", "worktreePath": "/bad" } });
    let err = run(&svc, &ctx, bad).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::WorkspaceInvalid);
    let missing = json!({ "workspace": { "mode": "new_worktree", "branchName": "x" } });
    let err = run(&svc, &ctx, missing).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::WorkspaceInvalid);
}

#[tokio::test]
async fn depth_and_rate_limits_hold() {
    let port = FakePort::new();
    working_caller(&port, ExecutionMode::Default);
    let mut previous = "caller".to_string();
    for i in 0..MAX_DEPTH {
        let id = format!("deep{i}");
        let mut chat = port.add_chat(&id);
        chat.created_by_chat_id = Some(previous.clone());
        chat.working = true;
        port.put(chat);
        previous = id;
    }
    let (svc, ctx) = service_with(port.clone(), &previous);
    let err = run(&svc, &ctx, json!({})).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::DepthLimitExceeded);

    let (svc, ctx) = service_with(port, "caller");
    for _ in 0..CREATION_LIMIT {
        run(&svc, &ctx, json!({})).await.unwrap();
    }
    let err = run(&svc, &ctx, json!({})).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::RateLimited);
}
