//! `chat_send`: message an existing chat now, after its turn, or into it.

use serde::Deserialize;
use serde_json::{Value, json};

use super::ToolDef;
use crate::errors::{ErrorCode, ToolError};
use crate::input::{
    Validate, check_id, check_text, id_schema, object_schema, parse_args, text_schema,
};
use crate::outbox::OutboxKind;
use crate::policy::check_ceiling;
use crate::ports::ChatView;
use crate::service::{CallCtx, OrchestrationService};
use crate::state::{AgentMessageKind, ChatState, wrap_agent_message};

pub(super) fn definition() -> ToolDef {
    ToolDef {
        name: "chat_send",
        title: "Send to a Mainframe chat",
        description: "Send a message to another chat. auto (default) starts a turn when the chat \
            is idle and otherwise holds the message until its current turn ends. queue always \
            waits for the turn to end. steer folds the message into the running turn at the \
            next tool boundary. The target's permission mode may not exceed the caller's.",
        input_schema: object_schema(
            json!({
                "chatId": id_schema("The chat to send to."),
                "message": text_schema("The message text."),
                "mode": { "enum": ["auto", "queue", "steer"], "description": "Default auto." }
            }),
            &["chatId", "message"],
        ),
        read_only: false,
        destructive: false,
        idempotent: false,
    }
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Mode {
    #[default]
    Auto,
    Queue,
    Steer,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Input {
    chat_id: String,
    message: String,
    #[serde(default)]
    mode: Mode,
}

impl Validate for Input {
    fn validate(&self) -> Result<(), ToolError> {
        check_id("chatId", &self.chat_id)?;
        check_text("message", &self.message)
    }
}

pub(super) async fn run(
    svc: &OrchestrationService,
    ctx: &CallCtx,
    args: Value,
) -> Result<Value, ToolError> {
    let input: Input = parse_args(args)?;
    let caller = svc.active_caller(ctx).await?;
    let target = sendable_target(svc, &input.chat_id).await?;
    let body = wrap_agent_message(&caller.id, AgentMessageKind::Send, &input.message);
    // Re-read right before dispatch: the user may have raised the target's
    // mode since the caller last looked.
    check_ceiling(caller.privileges(), target.privileges())?;
    let state = svc.state_of(&target);
    let (delivery, entry_id) = match (state, input.mode) {
        (ChatState::Idle, Mode::Steer) => {
            return Err(ToolError::new(
                ErrorCode::NoActiveTurn,
                "The chat has no active turn to steer.",
            ));
        }
        (ChatState::Idle, _) => {
            svc.port.send(&target.id, &body).await?;
            ("started", None)
        }
        (_, Mode::Steer) => {
            steer(svc, &target, &body).await?;
            ("steered", None)
        }
        _ => {
            let id = svc.outbox.push(
                &target.id,
                &caller.id,
                OutboxKind::Send,
                body,
                &input.message,
            );
            ("queued", Some(id))
        }
    };
    let after = svc.port.chat(&target.id).await.unwrap_or(target);
    Ok(json!({
        "chatId": after.id,
        "delivery": delivery,
        "outboxEntryId": entry_id,
        "state": svc.state_of(&after),
    }))
}

/// The target must exist, be agent-addressable, and still be live. Side,
/// temporary, and automation chats exist but are not sendable.
async fn sendable_target(svc: &OrchestrationService, chat_id: &str) -> Result<ChatView, ToolError> {
    let target =
        svc.port.chat(chat_id).await.ok_or_else(|| {
            ToolError::new(ErrorCode::ChatNotFound, format!("No chat {chat_id}."))
        })?;
    let ended = matches!(
        svc.state_of(&target),
        ChatState::Ended | ChatState::Archived
    );
    if ended || !target.is_agent_addressable() {
        return Err(ToolError::new(
            ErrorCode::ChatNotSendable,
            "The chat has ended or is archived.",
        ));
    }
    Ok(target)
}

async fn steer(svc: &OrchestrationService, target: &ChatView, body: &str) -> Result<(), ToolError> {
    let steerable = svc
        .port
        .adapters()
        .await
        .iter()
        .any(|a| a.id == target.adapter_id && a.steer);
    if !steerable {
        return Err(ToolError::new(
            ErrorCode::NotSteerable,
            format!(
                "Adapter {} cannot steer a running turn; use queue.",
                target.adapter_id
            ),
        ));
    }
    svc.port
        .steer(&target.id, body)
        .await
        .map_err(ToolError::from)
}

#[cfg(test)]
#[path = "chat_send_tests.rs"]
mod tests;
