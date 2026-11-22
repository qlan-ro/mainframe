use mainframe_orchestration::{
    errors::{ErrorCode, ToolError},
    ports::{ChatView, OrchestrationPort},
    state::derive_state,
    tools::chat_read_items::{render, to_item},
};
use mainframe_types::external_mcp::ExternalMcpClient;
use serde_json::{Value, json};

use super::input::{self, ListInput, ReadInput};
use crate::{ctx::AppCtx, orchestration_deps::DaemonOrchestrationPort};

pub fn port(ctx: &AppCtx) -> DaemonOrchestrationPort {
    DaemonOrchestrationPort::new(
        ctx.chat.chat_manager.clone(),
        ctx.core.db.clone(),
        ctx.core.adapter_registry.clone(),
        ctx.core.broadcast.clone(),
    )
}

pub fn project_access(client: &ExternalMcpClient, id: &str) -> Result<(), ToolError> {
    input::id(id)?;
    if !client.project_ids.iter().any(|p| p == id) {
        return Err(ToolError::new(
            ErrorCode::ProjectNotFound,
            "Project not found",
        ));
    }
    Ok(())
}

pub async fn target(
    ctx: &AppCtx,
    client: &ExternalMcpClient,
    id: &str,
) -> Result<ChatView, ToolError> {
    input::id(id)?;
    port(ctx)
        .chat(id)
        .await
        .filter(|c| c.is_agent_addressable() && client.project_ids.contains(&c.project_id))
        .ok_or_else(|| ToolError::new(ErrorCode::ChatNotFound, "Chat not found"))
}

pub async fn capabilities(ctx: &AppCtx, client: &ExternalMcpClient) -> Result<Value, ToolError> {
    let infos = ctx.core.adapter_registry.list().await;
    let adapters: Vec<_> = port(ctx)
        .adapters()
        .await
        .into_iter()
        .map(|a| {
            let models: Vec<_> = a
                .models
                .into_iter()
                .map(|m| json!({"id":m.id,"label":m.label}))
                .collect();
            json!({"id":a.id,"name":a.name,"available":a.available,"models":models,
                "autoModeAvailable":infos.iter().any(|i| i.id == a.id && i.capabilities.auto_mode)})
        })
        .collect();
    Ok(
        json!({"client":client, "adapters":adapters, "localOnly":true,
        "permissionPrompts": if super::definitions::allowed(client, super::definitions::ANSWER_TOOL) { "Answer with chat_answer, relaying the user's decision" } else { "Answer in Mainframe" }, "launchDefaultPermissionMode":"default"}),
    )
}

pub async fn projects(ctx: &AppCtx, client: &ExternalMcpClient) -> Result<Value, ToolError> {
    let ids = client.project_ids.clone();
    let projects = ctx
        .core
        .db
        .call(move |db| {
            Ok(db
                .projects
                .list()?
                .into_iter()
                .filter(|p| ids.contains(&p.id))
                .map(|p| json!({"id":p.id,"name":p.name,"path":p.path}))
                .collect::<Vec<_>>())
        })
        .await
        .map_err(ToolError::internal)?;
    Ok(json!({"projects":projects}))
}

pub async fn chats(
    ctx: &AppCtx,
    client: &ExternalMcpClient,
    input: ListInput,
) -> Result<Value, ToolError> {
    project_access(client, &input.project_id)?;
    input::page(input.limit, input.offset)?;
    let chats = port(ctx)
        .list_chats(&input.project_id, true)
        .await
        .map_err(ToolError::from)?;
    let all: Vec<_> = chats
        .into_iter()
        .filter(|c| c.is_agent_addressable())
        .collect();
    let next = (all.len() > input.offset.saturating_add(input.limit))
        .then_some(input.offset + input.limit);
    let chats: Vec<_> = all
        .iter()
        .skip(input.offset)
        .take(input.limit)
        .map(summary)
        .collect();
    Ok(json!({"chats":chats,"nextOffset":next}))
}

pub fn summary(chat: &ChatView) -> Value {
    json!({"id":chat.id,"projectId":chat.project_id,"title":chat.title,
        "adapterId":chat.adapter_id,"model":chat.model,"permissionMode":chat.permission_mode,
        "state":derive_state(chat, false),"updatedAt":chat.updated_at})
}

pub async fn read(
    ctx: &AppCtx,
    client: &ExternalMcpClient,
    input: ReadInput,
) -> Result<Value, ToolError> {
    let chat = target(ctx, client, &input.chat_id).await?;
    input::page(input.limit, 0)?;
    let messages = ctx.chat.chat_manager.get_messages(&chat.id).await;
    if let Some(id) = &input.message_id {
        return read_message(
            &chat,
            &messages,
            id,
            input.text_offset,
            input.after_message_id.is_some(),
        );
    }
    if input.text_offset != 0 {
        return Err(ToolError::invalid("textOffset requires messageId"));
    }
    let start = read_start(&messages, &input)?;
    let mut items = Vec::new();
    let mut used = 0;
    let mut next = input.after_message_id.clone();
    let mut more = false;
    for (position, message) in messages.iter().enumerate().skip(start) {
        let item = to_item(position, message, true).map(|i| render(&i, 0, 1000));
        let size = item.as_ref().map_or(0, |v| v.to_string().len());
        if items.len() == input.limit || used + size > 16_000 {
            more = true;
            break;
        }
        used += size;
        next = Some(message.id.clone());
        if let Some(item) = item {
            items.push(item);
        }
    }
    Ok(json!({"chat":summary(&chat),"items":items,"nextCursor":next,"hasMore":more}))
}

fn read_start(
    messages: &[mainframe_types::chat::ChatMessage],
    input: &ReadInput,
) -> Result<usize, ToolError> {
    Ok(match &input.after_message_id {
        Some(id) => messages
            .iter()
            .position(|m| &m.id == id)
            .map(|i| i + 1)
            .ok_or_else(|| {
                ToolError::new(
                    ErrorCode::InvalidCursor,
                    "Message no longer exists; read again without afterMessageId",
                )
            })?,
        None => messages.len().saturating_sub(input.limit),
    })
}

pub(super) fn read_message(
    chat: &ChatView,
    messages: &[mainframe_types::chat::ChatMessage],
    id: &str,
    offset: usize,
    after: bool,
) -> Result<Value, ToolError> {
    if after {
        return Err(ToolError::invalid("Use either messageId or afterMessageId"));
    }
    let (position, message) = messages
        .iter()
        .enumerate()
        .find(|(_, m)| m.id == id)
        .ok_or_else(|| ToolError::new(ErrorCode::InvalidCursor, "Message no longer exists"))?;
    let item = to_item(position, message, true)
        .ok_or_else(|| ToolError::invalid("Message has no readable text"))?;
    if offset > item.text.chars().count() {
        return Err(ToolError::invalid("textOffset exceeds the message length"));
    }
    Ok(
        json!({"chat":summary(chat),"items":[render(&item, offset, 1000)],"nextCursor":id,"hasMore":position + 1 < messages.len()}),
    )
}
