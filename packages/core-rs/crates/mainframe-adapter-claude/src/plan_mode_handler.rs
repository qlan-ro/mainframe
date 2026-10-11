//! Implements the `PlanModeActionHandler` trait from `mainframe-adapter-api`.
//! Recovering the latest plan file for approve-and-clear-context lives on the
//! `PlanActionContext` side (`recover_latest_plan_file`) so this crate needs no
//! chat dependency.

use mainframe_adapter_api::{
    AdapterError, BoxFuture, PlanActionContext, PlanChatUpdate, PlanModeActionHandler,
    clear_context_and_restart,
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
                clear_vendor_session_id: false,
            })?;

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
                    ..response.clone()
                };
                ctx.session_respond_to_permission(deny).await?;
                ctx.permissions_shift();
                ctx.session_kill().await?;
                ctx.clear_active_session();
            } else {
                ctx.permissions_shift();
            }

            clear_context_and_restart(&response, ctx).await
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
#[path = "plan_mode_handler_tests.rs"]
mod tests;
