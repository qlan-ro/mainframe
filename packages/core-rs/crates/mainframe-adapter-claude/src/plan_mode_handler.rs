//! Ported from `packages/core/src/plugins/builtin/claude/plan-mode-handler.ts`.
//!
//! Implements the (relocated) `PlanModeActionHandler` trait from
//! `mainframe-adapter-api`. The `extractLatestPlanFileFromMessages` call in the
//! TS `onApproveAndClearContext` lives on the `PlanActionContext` side now
//! (`recover_latest_plan_file`) so this crate needs no chat dependency.

use mainframe_adapter_api::{
    AdapterError, BoxFuture, PlanActionContext, PlanChatUpdate, PlanModeActionHandler,
};
use mainframe_types::adapter::{ControlBehavior, ControlResponse};
use mainframe_types::events::DaemonEvent;
use mainframe_types::settings::ExecutionMode;

pub struct ClaudePlanModeHandler;

impl PlanModeActionHandler for ClaudePlanModeHandler {
    fn on_approve<'a>(
        &'a self,
        response: ControlResponse,
        ctx: &'a dyn PlanActionContext,
    ) -> BoxFuture<'a, Result<(), AdapterError>> {
        Box::pin(async move {
            let exec = response.execution_mode.unwrap_or(ExecutionMode::Default);
            ctx.update_chat(PlanChatUpdate {
                plan_mode: Some(false),
                permission_mode: Some(exec),
                clear_claude_session_id: false,
            });
            ctx.emit_chat_updated();

            if ctx.session_is_spawned() {
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
        Box::pin(async move {
            let exec = response.execution_mode.unwrap_or(ExecutionMode::Default);
            let plan = response
                .updated_input
                .as_ref()
                .and_then(|m| m.get("plan"))
                .and_then(|v| v.as_str())
                .map(str::to_string);

            let recovered_plan_path = ctx.recover_latest_plan_file();
            if let Some(path) = recovered_plan_path
                && ctx.add_plan_file(path)
            {
                ctx.emit_event(DaemonEvent::ContextUpdated {
                    chat_id: ctx.chat_id(),
                    file_paths: None,
                });
            }

            if ctx.session_is_spawned() {
                let deny = ControlResponse {
                    behavior: ControlBehavior::Deny,
                    message: Some(
                        "User chose to clear context and start a new session.".to_string(),
                    ),
                    ..response
                };
                ctx.session_respond_to_permission(deny).await?;
                ctx.permissions_shift();
                ctx.session_kill().await?;
                ctx.clear_active_session();
            } else {
                ctx.permissions_shift();
            }

            ctx.update_chat(PlanChatUpdate {
                plan_mode: Some(false),
                permission_mode: Some(exec),
                clear_claude_session_id: true,
            });
            ctx.emit_chat_updated();

            ctx.clear_messages();
            ctx.clear_display_cache();
            ctx.emit_event(DaemonEvent::MessagesCleared {
                chat_id: ctx.chat_id(),
            });

            ctx.start_chat().await?;
            if let Some(plan) = plan {
                ctx.send_message(format!("Implement the following plan:\n\n{plan}"))
                    .await?;
            }
            Ok(())
        })
    }

    fn on_reject<'a>(
        &'a self,
        response: ControlResponse,
        ctx: &'a dyn PlanActionContext,
    ) -> BoxFuture<'a, Result<(), AdapterError>> {
        Box::pin(async move {
            if ctx.session_is_spawned() {
                ctx.session_respond_to_permission(response).await?;
            }
            Ok(())
        })
    }

    fn on_revise<'a>(
        &'a self,
        _feedback: String,
        response: ControlResponse,
        ctx: &'a dyn PlanActionContext,
    ) -> BoxFuture<'a, Result<(), AdapterError>> {
        Box::pin(async move {
            // Claude handles feedback via respondToPermission's message field.
            if ctx.session_is_spawned() {
                ctx.session_respond_to_permission(response).await?;
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct Recorded {
        updates: Vec<PlanChatUpdate>,
        chat_updated: usize,
        events: Vec<DaemonEvent>,
        set_permission_mode: Vec<ExecutionMode>,
        responded: Vec<ControlResponse>,
        kills: usize,
        cleared_active: usize,
        shifts: usize,
        cleared_messages: usize,
        cleared_display: usize,
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
            "c1".to_string()
        }
        fn update_chat(&self, patch: PlanChatUpdate) {
            self.rec().updates.push(patch);
        }
        fn emit_chat_updated(&self) {
            self.rec().chat_updated += 1;
        }
        fn emit_event(&self, event: DaemonEvent) {
            self.rec().events.push(event);
        }
        fn session_is_spawned(&self) -> bool {
            self.has_session
        }
        fn session_set_permission_mode(
            &self,
            mode: ExecutionMode,
        ) -> BoxFuture<'_, Result<(), AdapterError>> {
            self.rec().set_permission_mode.push(mode);
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
        fn clear_display_cache(&self) {
            self.rec().cleared_display += 1;
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

    fn base_response() -> ControlResponse {
        ControlResponse {
            request_id: "r1".to_string(),
            tool_use_id: "t1".to_string(),
            tool_name: Some("ExitPlanMode".to_string()),
            behavior: ControlBehavior::Allow,
            updated_input: None,
            updated_permissions: None,
            message: None,
            execution_mode: Some(ExecutionMode::AcceptEdits),
            clear_context: None,
        }
    }

    #[tokio::test]
    async fn on_approve_clears_plan_mode_and_calls_set_permission_mode_with_base_mode() {
        let ctx = MockCtx::new(true);
        let handler = ClaudePlanModeHandler;
        handler.on_approve(base_response(), &ctx).await.unwrap();

        let rec = ctx.rec();
        assert_eq!(
            rec.updates,
            vec![PlanChatUpdate {
                plan_mode: Some(false),
                permission_mode: Some(ExecutionMode::AcceptEdits),
                clear_claude_session_id: false,
            }]
        );
        assert_eq!(rec.set_permission_mode, vec![ExecutionMode::AcceptEdits]);
        assert_eq!(rec.chat_updated, 1);
    }

    #[tokio::test]
    async fn on_reject_forwards_the_deny_response_to_respond_to_permission() {
        let ctx = MockCtx::new(true);
        let handler = ClaudePlanModeHandler;
        let mut deny = base_response();
        deny.behavior = ControlBehavior::Deny;
        deny.message = Some("needs more work".to_string());
        handler.on_reject(deny.clone(), &ctx).await.unwrap();
        assert_eq!(ctx.rec().responded, vec![deny]);
    }

    #[tokio::test]
    async fn on_approve_and_clear_context_kills_resets_clears_and_starts() {
        let ctx = MockCtx::new(true);
        let handler = ClaudePlanModeHandler;
        handler
            .on_approve_and_clear_context(base_response(), &ctx)
            .await
            .unwrap();

        let rec = ctx.rec();
        assert_eq!(rec.kills, 1);
        assert!(rec.updates.iter().any(|u| {
            u.clear_claude_session_id
                && u.plan_mode == Some(false)
                && u.permission_mode == Some(ExecutionMode::AcceptEdits)
        }));
        assert!(
            rec.events
                .iter()
                .any(|e| matches!(e, DaemonEvent::MessagesCleared { chat_id } if chat_id == "c1"))
        );
        assert_eq!(rec.started, 1);
        assert_eq!(rec.cleared_messages, 1);
        assert_eq!(rec.cleared_display, 1);
    }

    #[tokio::test]
    async fn on_approve_and_clear_context_sends_follow_up_when_plan_present() {
        let ctx = MockCtx::new(true);
        let handler = ClaudePlanModeHandler;
        let mut resp = base_response();
        let mut input = std::collections::HashMap::new();
        input.insert(
            "plan".to_string(),
            serde_json::Value::String("Step 1: do the thing.".to_string()),
        );
        resp.updated_input = Some(input);
        handler
            .on_approve_and_clear_context(resp, &ctx)
            .await
            .unwrap();

        assert!(
            ctx.rec()
                .sent
                .iter()
                .any(|s| s.contains("Step 1: do the thing."))
        );
    }

    #[tokio::test]
    async fn on_approve_and_clear_context_works_when_session_null() {
        let ctx = MockCtx::new(false);
        let handler = ClaudePlanModeHandler;
        handler
            .on_approve_and_clear_context(base_response(), &ctx)
            .await
            .unwrap();

        let rec = ctx.rec();
        assert_eq!(rec.shifts, 1);
        assert_eq!(rec.started, 1);
        assert_eq!(rec.kills, 0);
    }
}

// PORT STATUS: src/plugins/builtin/claude/plan-mode-handler.ts (70 lines)
// confidence: high
// todos: 0
// notes: implements the relocated mainframe-adapter-api::PlanModeActionHandler.
// notes: extractLatestPlanFileFromMessages moved to PlanActionContext
// notes: (recover_latest_plan_file) so no chat/context-tracker dep is needed here.
// notes: plan-mode-handler.test.ts ported assertion-for-assertion against a
// notes: recording MockCtx (mirrors the TS vi.fn() mock context).
