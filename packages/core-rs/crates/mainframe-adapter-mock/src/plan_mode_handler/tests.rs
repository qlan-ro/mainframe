use std::sync::Mutex;

use mainframe_types::adapter::ControlBehavior;
use mainframe_types::events::DaemonEvent;

use super::*;

#[derive(Default)]
struct Recorded {
    updates: Vec<PlanChatUpdate>,
    responded: Vec<ControlResponse>,
    kills: usize,
    cleared_active: usize,
    shifts: usize,
    cleared_messages: usize,
    cleared_display: usize,
    transcript_cleared: usize,
    started: usize,
    sent: Vec<String>,
}

struct MockCtx {
    has_session: bool,
    rec: Mutex<Recorded>,
}

impl MockCtx {
    fn new(has_session: bool) -> Self {
        Self {
            has_session,
            rec: Mutex::new(Recorded::default()),
        }
    }
    fn rec(&self) -> std::sync::MutexGuard<'_, Recorded> {
        self.rec.lock().unwrap()
    }
}

impl PlanActionContext for MockCtx {
    fn chat_id(&self) -> String {
        "chat-1".to_string()
    }
    fn update_chat(&self, patch: PlanChatUpdate) {
        self.rec().updates.push(patch);
    }
    fn emit_chat_updated(&self) {}
    fn emit_event(&self, _event: DaemonEvent) {}
    fn session_is_spawned(&self) -> bool {
        self.has_session
    }
    fn session_set_permission_mode(
        &self,
        _mode: ExecutionMode,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
    fn session_respond_to_permission(
        &self,
        response: ControlResponse,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.rec().responded.push(response);
        Box::pin(async { Ok(()) })
    }
    fn session_kill(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.rec().kills += 1;
        Box::pin(async { Ok(()) })
    }
    fn clear_active_session(&self) {
        self.rec().cleared_active += 1;
    }
    fn permissions_shift(&self) {
        self.rec().shifts += 1;
    }
    fn recover_latest_plan_file(&self) -> Option<String> {
        None
    }
    fn add_plan_file(&self, _path: String) -> bool {
        false
    }
    fn clear_messages(&self) {
        self.rec().cleared_messages += 1;
    }
    fn clear_display_state(&self) {
        self.rec().cleared_display += 1;
    }
    fn notify_transcript_cleared(&self) {
        self.rec().transcript_cleared += 1;
    }
    fn start_chat(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.rec().started += 1;
        Box::pin(async { Ok(()) })
    }
    fn send_message(&self, content: String) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.rec().sent.push(content);
        Box::pin(async { Ok(()) })
    }
}

fn approval() -> ControlResponse {
    ControlResponse {
        request_id: "r1".to_string(),
        tool_use_id: "t1".to_string(),
        tool_name: Some("ExitPlanMode".to_string()),
        behavior: ControlBehavior::Allow,
        updated_input: Some(std::collections::HashMap::from([(
            "plan".to_string(),
            serde_json::Value::String("Step 1: do the thing.".to_string()),
        )])),
        updated_permissions: None,
        message: None,
        execution_mode: Some(ExecutionMode::AcceptEdits),
        clear_context: None,
        scope: None,
    }
}

#[tokio::test]
async fn approving_with_clear_context_wipes_the_transcript_and_restarts_from_the_recording() {
    let ctx = MockCtx::new(true);

    MockPlanModeHandler
        .on_approve_and_clear_context(approval(), &ctx)
        .await
        .unwrap();

    let rec = ctx.rec();
    assert_eq!(rec.cleared_messages, 1);
    assert_eq!(rec.transcript_cleared, 1);
    assert_eq!(rec.cleared_display, 1);
    assert_eq!(rec.shifts, 1);
    assert_eq!((rec.kills, rec.cleared_active), (1, 1));
    assert_eq!(rec.started, 1);
    assert!(rec.sent.iter().any(|s| s.contains("Step 1: do the thing.")));
    assert_eq!(
        rec.updates,
        vec![PlanChatUpdate {
            plan_mode: Some(false),
            permission_mode: Some(ExecutionMode::AcceptEdits),
            clear_claude_session_id: true,
        }]
    );
    // The chat layer's clear-context branch never forwarded the answer, and the
    // discarded session's remaining fixture is never replayed — so the handler
    // must not spend a recorded `respondToPermission` marker on it.
    assert!(rec.responded.is_empty());
}

#[tokio::test]
async fn approving_with_clear_context_restarts_a_chat_whose_session_is_gone() {
    let ctx = MockCtx::new(false);

    MockPlanModeHandler
        .on_approve_and_clear_context(approval(), &ctx)
        .await
        .unwrap();

    let rec = ctx.rec();
    assert_eq!((rec.kills, rec.cleared_active), (0, 0));
    assert_eq!(rec.shifts, 1);
    assert_eq!(rec.started, 1);
}

#[tokio::test]
async fn approving_without_clear_context_leaves_the_transcript_alone() {
    let ctx = MockCtx::new(true);

    MockPlanModeHandler
        .on_approve(approval(), &ctx)
        .await
        .unwrap();

    let rec = ctx.rec();
    assert_eq!(rec.cleared_messages, 0);
    assert_eq!(rec.transcript_cleared, 0);
    assert_eq!(rec.started, 0);
    assert!(rec.responded.is_empty());
    assert_eq!(
        rec.updates,
        vec![PlanChatUpdate {
            plan_mode: Some(false),
            permission_mode: Some(ExecutionMode::AcceptEdits),
            clear_claude_session_id: false,
        }]
    );
}
