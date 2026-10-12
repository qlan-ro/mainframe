//! `chat_interrupt`: stop a chat's active turn and everything it delegated.

use serde::Deserialize;
use serde_json::{Value, json};

use super::ToolDef;
use crate::errors::{ErrorCode, ToolError};
use crate::input::{
    Validate, check_id, check_opt_len, id_schema, object_schema, parse_args, string_schema,
};
use crate::policy::{REASON_MAX, check_ceiling};
use crate::service::{CallCtx, OrchestrationService};
use crate::state::ChatState;

pub(super) fn definition() -> ToolDef {
    ToolDef {
        name: "chat_interrupt",
        title: "Interrupt a Mainframe chat",
        description: "Stop a chat's active turn. Its delegated tasks are cancelled first, deepest \
            first, and messages Mainframe was holding for it are dropped. The chat itself is \
            kept and can be continued. Returns no_active_turn when the chat is idle.",
        input_schema: object_schema(
            json!({
                "chatId": id_schema("The chat to interrupt."),
                "reason": string_schema(REASON_MAX, "Why, recorded on cancelled tasks.")
            }),
            &["chatId"],
        ),
        read_only: false,
        destructive: true,
        idempotent: false,
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Input {
    chat_id: String,
    reason: Option<String>,
}

impl Validate for Input {
    fn validate(&self) -> Result<(), ToolError> {
        check_id("chatId", &self.chat_id)?;
        check_opt_len("reason", self.reason.as_deref(), REASON_MAX)
    }
}

pub(super) async fn run(
    svc: &OrchestrationService,
    ctx: &CallCtx,
    args: Value,
) -> Result<Value, ToolError> {
    let input: Input = parse_args(args)?;
    let caller = svc.active_caller(ctx).await?;
    let target = svc.target_chat(&input.chat_id, &caller).await?;
    check_ceiling(&caller.privileges(), &target.privileges())?;
    if !matches!(
        svc.state_of(&target),
        ChatState::Working | ChatState::WaitingForPermission
    ) {
        return Err(ToolError::new(
            ErrorCode::NoActiveTurn,
            "The chat has no active turn to interrupt.",
        ));
    }
    let cancelled = svc.cascade_stop(&target.id, input.reason.as_deref()).await;
    svc.port.interrupt(&target.id).await;
    let after = svc.port.chat(&target.id).await.unwrap_or(target);
    Ok(json!({
        "chatId": after.id,
        "interrupted": true,
        "state": svc.state_of(&after),
        "cancelledTaskIds": cancelled,
    }))
}

#[cfg(test)]
#[path = "chat_interrupt_tests.rs"]
mod tests;
