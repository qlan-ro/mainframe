//! RED tests (T3) for the plan-mode dispatcher wiring: `ChatManager::respond_to_permission`
//! must forward the three `PhDeps::plan_mode_*` branches to a resolved adapter handler.
//! A child module of `tests`, so it sees `tests`' private `StoreDeps`/`RecSession`/`seed_active`.

use super::*;
use mainframe_adapter_api::PlanActionContext;
use mainframe_types::adapter::ControlBehavior;

/// Records which `PlanModeActionHandler` method fired, in order, plus the response
/// each call received — enough to pin the dispatcher's forwarding without
/// re-testing `ClaudePlanModeHandler`'s own behavior (covered in its own crate).
struct RecordingHandler {
    calls: Mutex<Vec<(&'static str, ControlResponse)>>,
}

impl RecordingHandler {
    fn arc() -> Arc<Self> {
        Arc::new(Self {
            calls: Mutex::new(Vec::new()),
        })
    }
}

impl PlanModeActionHandler for RecordingHandler {
    fn on_approve<'a>(
        &'a self,
        response: ControlResponse,
        ctx: &'a dyn PlanActionContext,
    ) -> BoxFuture<'a, Result<(), AdapterError>> {
        self.calls
            .lock()
            .unwrap()
            .push(("on_approve", response.clone()));
        Box::pin(async move {
            if ctx.session_is_spawned() {
                let exec = response.execution_mode.unwrap_or(ExecutionMode::Default);
                ctx.session_set_permission_mode(exec).await?;
                ctx.session_respond_to_permission(response).await?;
            }
            Ok(())
        })
    }

    fn on_approve_and_clear_context<'a>(
        &'a self,
        response: ControlResponse,
        ctx: &'a dyn PlanActionContext,
    ) -> BoxFuture<'a, Result<(), AdapterError>> {
        self.calls
            .lock()
            .unwrap()
            .push(("on_approve_and_clear_context", response.clone()));
        Box::pin(async move {
            let plan = response
                .updated_input
                .as_ref()
                .and_then(|m| m.get("plan"))
                .and_then(|v| v.as_str())
                .map(str::to_string);
            match plan {
                Some(plan) => ctx.send_message(plan).await,
                None => Ok(()),
            }
        })
    }

    fn on_reject<'a>(
        &'a self,
        response: ControlResponse,
        _ctx: &'a dyn PlanActionContext,
    ) -> BoxFuture<'a, Result<(), AdapterError>> {
        self.calls.lock().unwrap().push(("on_reject", response));
        Box::pin(async { Ok(()) })
    }

    fn on_revise<'a>(
        &'a self,
        _feedback: String,
        response: ControlResponse,
        _ctx: &'a dyn PlanActionContext,
    ) -> BoxFuture<'a, Result<(), AdapterError>> {
        self.calls.lock().unwrap().push(("on_revise", response));
        Box::pin(async { Ok(()) })
    }
}

fn exit_plan_response(
    request_id: &str,
    execution_mode: Option<ExecutionMode>,
    clear_context: Option<bool>,
) -> ControlResponse {
    ControlResponse {
        request_id: request_id.to_string(),
        tool_use_id: "t1".to_string(),
        tool_name: Some("ExitPlanMode".to_string()),
        behavior: ControlBehavior::Allow,
        updated_input: None,
        updated_permissions: None,
        message: None,
        execution_mode,
        clear_context,
    }
}

fn no_session_chat(chat_id: &str) -> (Arc<StoreDeps>, ChatManager) {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let mut chat = test_chat(chat_id);
    chat.plan_mode = Some(true);
    mgr.active_chats.insert(
        chat_id.to_string(),
        Arc::new(Mutex::new(ActiveChat {
            chat,
            session: None,
            turn_started_at: None,
        })),
    );
    (deps, mgr)
}

#[tokio::test]
async fn forwards_an_exit_plan_mode_approval_to_the_adapter_handler() {
    let handler = RecordingHandler::arc();
    let deps = StoreDeps::arc();
    *deps.plan_handler.lock().unwrap() = Some(handler.clone() as Arc<dyn PlanModeActionHandler>);
    let mgr = ChatManager::new(deps);
    let session = RecSession::new("s1", false, true);
    seed_active(&mgr, "c1", test_chat("c1"), session);

    let response = exit_plan_response("r1", Some(ExecutionMode::AcceptEdits), None);
    mgr.respond_to_permission("c1", response).await.unwrap();

    let calls = handler.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, "on_approve");
    assert_eq!(calls[0].1.execution_mode, Some(ExecutionMode::AcceptEdits));
}

#[tokio::test]
async fn forwards_a_clear_context_approval_to_the_adapter_handler() {
    let handler = RecordingHandler::arc();
    let deps = StoreDeps::arc();
    *deps.plan_handler.lock().unwrap() = Some(handler.clone() as Arc<dyn PlanModeActionHandler>);
    let mgr = ChatManager::new(deps);
    let session = RecSession::new("s1", false, true);
    seed_active(&mgr, "c1", test_chat("c1"), session);

    let response = exit_plan_response("r1", Some(ExecutionMode::Default), Some(true));
    mgr.respond_to_permission("c1", response).await.unwrap();

    let calls = handler.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, "on_approve_and_clear_context");
}

#[tokio::test]
async fn persists_permission_mode_and_plan_mode_false_with_no_live_session() {
    let handler = RecordingHandler::arc();
    let (deps, mgr) = no_session_chat("c1");
    *deps.plan_handler.lock().unwrap() = Some(handler.clone() as Arc<dyn PlanModeActionHandler>);

    let response = exit_plan_response("r1", Some(ExecutionMode::AcceptEdits), None);
    mgr.respond_to_permission("c1", response).await.unwrap();

    assert!(handler.calls.lock().unwrap().is_empty());
    let updates = deps.updates.lock().unwrap();
    assert!(updates.iter().any(|(id, patch)| id == "c1"
        && patch.permission_mode == Some(ExecutionMode::AcceptEdits)
        && patch.plan_mode == Some(false)));
    assert!(
        deps.events()
            .iter()
            .any(|e| matches!(e, DaemonEvent::ChatUpdated { chat, .. } if chat.id == "c1"))
    );
}

#[tokio::test]
async fn defaults_a_missing_execution_mode_to_interactive() {
    let (deps, mgr) = no_session_chat("c1");

    let response = exit_plan_response("r1", None, None);
    mgr.respond_to_permission("c1", response).await.unwrap();

    let updates = deps.updates.lock().unwrap();
    assert!(updates.iter().any(|(id, patch)| id == "c1"
        && patch.permission_mode == Some(ExecutionMode::Default)
        && patch.plan_mode == Some(false)));
}

#[tokio::test]
async fn warns_and_no_ops_when_the_adapter_has_no_handler() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = RecSession::new("s1", false, true);
    seed_active(&mgr, "c1", test_chat("c1"), session);

    let response = exit_plan_response("r1", Some(ExecutionMode::AcceptEdits), None);
    let result = mgr.respond_to_permission("c1", response).await;

    assert!(result.is_ok());
    assert!(deps.updates.lock().unwrap().is_empty());
}

#[tokio::test]
async fn answers_the_escalation_on_the_wire_exactly_once_via_the_permission_handler_and_once_via_the_handler()
 {
    let handler = RecordingHandler::arc();
    let deps = StoreDeps::arc();
    *deps.plan_handler.lock().unwrap() = Some(handler.clone() as Arc<dyn PlanModeActionHandler>);
    let mgr = ChatManager::new(deps);
    let session = RecSession::new("s1", false, true);
    seed_active(&mgr, "c1", test_chat("c1"), session.clone());

    let response = exit_plan_response("r1", Some(ExecutionMode::AcceptEdits), None);
    mgr.respond_to_permission("c1", response).await.unwrap();

    // Preserved deliberately (decision 6, plan T3/T12): `handle_normal_permission`
    // already answers the CLI before dispatching to the plan-mode handler, which
    // answers again inside `on_approve`. This is the ported TS's double-send; do
    // not "fix" it here without re-reading T12's live-verification contingency.
    assert_eq!(session.responded_calls.lock().unwrap().len(), 2);
    assert_eq!(session.permission_mode_calls.lock().unwrap().len(), 1);
}

/// T6's `PlanHostImpl`-specific case: `ChatManager::new` alone never calls
/// `attach_self` (only `build_chat_manager` does), so a manager built the way
/// this crate's tests build one is exactly the "never attached" state the
/// clear-context follow-up send must fail closed against.
#[tokio::test]
async fn clear_context_follow_up_send_fails_closed_when_chatmanager_is_never_attached() {
    let handler = RecordingHandler::arc();
    let deps = StoreDeps::arc();
    *deps.plan_handler.lock().unwrap() = Some(handler.clone() as Arc<dyn PlanModeActionHandler>);
    let mgr = ChatManager::new(deps);
    let session = RecSession::new("s1", false, true);
    seed_active(&mgr, "c1", test_chat("c1"), session);

    let mut response = exit_plan_response("r1", Some(ExecutionMode::Default), Some(true));
    let mut input = std::collections::HashMap::new();
    input.insert(
        "plan".to_string(),
        serde_json::Value::String("do the thing".to_string()),
    );
    response.updated_input = Some(input);

    let result = mgr.respond_to_permission("c1", response).await;
    assert!(result.is_err());
}
