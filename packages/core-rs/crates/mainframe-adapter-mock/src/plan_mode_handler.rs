//! Plan-mode actions for the replay adapter.
//!
//! Only the clear-context branch does real work: the chat layer's permission
//! handler returns early on it, so nothing else answers the gate, restarts the
//! chat, or wipes the transcript. The other three branches run *after* that
//! handler already forwarded the response, and a replay session must not consume
//! a second recorded `respondToPermission` marker for one answer.

use mainframe_adapter_api::{
    AdapterError, BoxFuture, PlanActionContext, PlanChatUpdate, PlanModeActionHandler,
    clear_context_and_restart,
};
use mainframe_types::adapter::ControlResponse;
use mainframe_types::settings::ExecutionMode;

pub(crate) struct MockPlanModeHandler;

impl PlanModeActionHandler for MockPlanModeHandler {
    fn on_approve<'a>(
        &'a self,
        response: ControlResponse,
        ctx: &'a dyn PlanActionContext,
    ) -> BoxFuture<'a, Result<(), AdapterError>> {
        Box::pin(async move {
            ctx.update_chat(PlanChatUpdate {
                plan_mode: Some(false),
                permission_mode: Some(response.execution_mode.unwrap_or(ExecutionMode::Default)),
                clear_claude_session_id: false,
            });
            ctx.emit_chat_updated();
            Ok(())
        })
    }

    fn on_approve_and_clear_context<'a>(
        &'a self,
        response: ControlResponse,
        ctx: &'a dyn PlanActionContext,
    ) -> BoxFuture<'a, Result<(), AdapterError>> {
        Box::pin(async move {
            ctx.permissions_shift();
            if ctx.session_is_spawned() {
                ctx.session_kill().await?;
                ctx.clear_active_session();
            }
            clear_context_and_restart(&response, ctx).await
        })
    }

    fn on_reject<'a>(
        &'a self,
        _response: ControlResponse,
        ctx: &'a dyn PlanActionContext,
    ) -> BoxFuture<'a, Result<(), AdapterError>> {
        Box::pin(async move {
            tracing::debug!(chat_id = %ctx.chat_id(), "mock-cli: plan rejection already forwarded");
            Ok(())
        })
    }

    fn on_revise<'a>(
        &'a self,
        _feedback: String,
        _response: ControlResponse,
        ctx: &'a dyn PlanActionContext,
    ) -> BoxFuture<'a, Result<(), AdapterError>> {
        Box::pin(async move {
            tracing::debug!(chat_id = %ctx.chat_id(), "mock-cli: plan revision already forwarded");
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests;
