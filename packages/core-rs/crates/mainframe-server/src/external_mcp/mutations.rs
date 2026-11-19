use mainframe_orchestration::{
    errors::{ErrorCode, ToolError},
    policy::{Privileges, check_ceiling},
    ports::ChatView,
};
use mainframe_types::{chat::NewChat, external_mcp::ExternalMcpClient, settings::ExecutionMode};
use serde_json::{Value, json};

use super::{
    input::{self, ChatInput, LaunchInput, SendInput},
    reads,
};
use crate::ctx::AppCtx;

pub(super) fn ceiling(
    client: &ExternalMcpClient,
    adapter: &str,
    mode: ExecutionMode,
) -> Result<(), ToolError> {
    check_ceiling(
        &Privileges {
            adapter_id: adapter.into(),
            mode: client.max_permission_mode,
            plan: false,
        },
        &Privileges {
            adapter_id: adapter.into(),
            mode,
            plan: false,
        },
    )
}

pub(super) async fn writable(
    ctx: &AppCtx,
    client: &ExternalMcpClient,
    id: &str,
) -> Result<ChatView, ToolError> {
    let chat = reads::target(ctx, client, id).await?;
    ceiling(client, &chat.adapter_id, chat.permission_mode)?;
    if chat.status == mainframe_types::chat::ChatStatus::Archived {
        return Err(ToolError::new(
            ErrorCode::ChatNotSendable,
            "Restore the archived chat in Mainframe first",
        ));
    }
    Ok(chat)
}

pub(super) async fn adapter(
    ctx: &AppCtx,
    id: &str,
    model: Option<&str>,
    mode: ExecutionMode,
) -> Result<(), ToolError> {
    input::id(id)?;
    let infos = ctx.core.adapter_registry.list().await;
    let info = infos
        .iter()
        .find(|i| i.id == id && i.installed)
        .ok_or_else(|| {
            ToolError::new(ErrorCode::AdapterUnavailable, "Provider is not available")
        })?;
    if mode == ExecutionMode::Auto && !info.capabilities.auto_mode {
        return Err(ToolError::invalid(
            "This provider does not support Auto permission mode",
        ));
    }
    if model
        .is_some_and(|m| m.is_empty() || m.len() > 200 || !info.models.iter().any(|v| v.id == m))
    {
        return Err(ToolError::new(
            ErrorCode::ModelUnavailable,
            "Choose a model returned by capabilities",
        ));
    }
    Ok(())
}

fn attributed(client: &ExternalMcpClient, text: &str) -> String {
    format!("From external client {}:\n\n{text}", client.name)
}

pub async fn launch(
    ctx: &AppCtx,
    client: &ExternalMcpClient,
    input: LaunchInput,
) -> Result<Value, ToolError> {
    reads::project_access(client, &input.project_id)?;
    input::text(&input.prompt)?;
    let mode = input.permission_mode.unwrap_or(ExecutionMode::Default);
    adapter(ctx, &input.adapter_id, input.model.as_deref(), mode).await?;
    ceiling(client, &input.adapter_id, mode)?;
    let chat = ctx
        .chat
        .chat_manager
        .create_chat_with_defaults(
            NewChat {
                project_id: input.project_id,
                adapter_id: input.adapter_id,
                model: input.model,
                permission_mode: Some(mode.as_str().to_owned()),
                ..Default::default()
            },
            None,
            None,
        )
        .await
        .map_err(ToolError::internal)?;
    let result = ctx
        .chat
        .chat_manager
        .send_message(&chat.id, &attributed(client, &input.prompt), None, None)
        .await;
    tracing::info!(external_client_id = %client.id, chat_id = %chat.id, "external client launched chat");
    match result {
        Ok(()) => Ok(json!({"chatId":chat.id,"sent":true})),
        Err(_) => Ok(
            json!({"chatId":chat.id,"sent":false,"error":"Chat created, but the prompt could not be sent. Inspect this chat before retrying."}),
        ),
    }
}

pub async fn send(
    ctx: &AppCtx,
    client: &ExternalMcpClient,
    input: SendInput,
) -> Result<Value, ToolError> {
    let chat = writable(ctx, client, &input.chat_id).await?;
    input::text(&input.text)?;
    ctx.chat
        .chat_manager
        .send_message(&chat.id, &attributed(client, &input.text), None, None)
        .await
        .map_err(|_| {
            ToolError::new(
                ErrorCode::ChatNotSendable,
                "Message could not be sent; check the chat in Mainframe",
            )
        })?;
    tracing::info!(external_client_id = %client.id, chat_id = %chat.id, "external client sent message");
    Ok(json!({"chatId":chat.id,"sent":true}))
}

pub async fn interrupt(
    ctx: &AppCtx,
    client: &ExternalMcpClient,
    input: ChatInput,
) -> Result<Value, ToolError> {
    let chat = writable(ctx, client, &input.chat_id).await?;
    ctx.chat.chat_manager.interrupt_chat(&chat.id).await;
    tracing::info!(external_client_id = %client.id, chat_id = %chat.id, "external client interrupted chat");
    Ok(json!({"chatId":chat.id,"interrupted":true}))
}
