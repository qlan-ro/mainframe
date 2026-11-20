use super::{
    input::ConfigureInput,
    mutations::{adapter, ceiling, writable},
    reads,
};
use crate::ctx::AppCtx;
use mainframe_chat::config_manager::{ConfigError, ConfigUpdate};
use mainframe_orchestration::{
    errors::{ErrorCode, ToolError},
    ports::ChatView,
};
use mainframe_types::{
    chat::Chat, external_mcp::ExternalMcpClient, segment::SwitchProviderRequest,
};
use serde_json::Value;

pub async fn configure(
    ctx: &AppCtx,
    client: &ExternalMcpClient,
    input: ConfigureInput,
) -> Result<Value, ToolError> {
    let chat = writable(ctx, client, &input.chat_id).await?;
    if chat.working || chat.pending_permission.is_some() {
        return Err(ToolError::new(
            ErrorCode::ChatNotSendable,
            "Wait for the chat to become idle before changing its configuration",
        ));
    }
    let provider = input.adapter_id.as_deref().unwrap_or(&chat.adapter_id);
    adapter(
        ctx,
        provider,
        input.model.as_deref(),
        input.permission_mode.unwrap_or(chat.permission_mode),
    )
    .await?;
    ceiling(
        client,
        provider,
        input.permission_mode.unwrap_or(chat.permission_mode),
    )?;
    if provider != chat.adapter_id {
        switch(ctx, client, &chat, &input).await?;
    } else {
        update(ctx, client, &chat, &input).await?;
    }
    tracing::info!(external_client_id = %client.id, chat_id = %chat.id, "external client configured chat");
    Ok(reads::summary(&reads::target(ctx, client, &chat.id).await?))
}

async fn switch(
    ctx: &AppCtx,
    client: &ExternalMcpClient,
    chat: &ChatView,
    input: &ConfigureInput,
) -> Result<(), ToolError> {
    if input.permission_mode.is_some() {
        return Err(ToolError::invalid(
            "Change the provider and permission mode in separate calls",
        ));
    }
    ctx.chat
        .chat_manager
        .switch_provider_checked(
            &chat.id,
            &SwitchProviderRequest {
                adapter_id: input
                    .adapter_id
                    .clone()
                    .unwrap_or_else(|| chat.adapter_id.clone()),
                model: input.model.clone(),
                tuning: None,
            },
            &|fresh| check_current(client, chat, input, fresh),
        )
        .await
        .map_err(|_| {
            ToolError::invalid("Provider could not be switched; check the chat in Mainframe")
        })?;
    Ok(())
}

fn check_current(
    client: &ExternalMcpClient,
    expected: &ChatView,
    input: &ConfigureInput,
    fresh: &Chat,
) -> Result<(), ConfigError> {
    if fresh.adapter_id != expected.adapter_id
        || fresh
            .permission_mode
            .unwrap_or(mainframe_types::settings::ExecutionMode::Default)
            != expected.permission_mode
        || fresh.status != expected.status
    {
        return Err(ConfigError::Refused(
            "Chat configuration changed; read it again before retrying".into(),
        ));
    }
    let provider = input.adapter_id.as_deref().unwrap_or(&fresh.adapter_id);
    let mode = input.permission_mode.unwrap_or(
        fresh
            .permission_mode
            .unwrap_or(mainframe_types::settings::ExecutionMode::Default),
    );
    ceiling(client, provider, mode)
        .map_err(|_| ConfigError::Refused("Permission ceiling exceeded".into()))
}

async fn update(
    ctx: &AppCtx,
    client: &ExternalMcpClient,
    chat: &ChatView,
    input: &ConfigureInput,
) -> Result<(), ToolError> {
    if input.model.is_none() && input.permission_mode.is_none() {
        return Err(ToolError::invalid(
            "Specify a model, provider or permission mode",
        ));
    }
    ctx.chat
        .chat_manager
        .update_chat_config_checked(
            &chat.id,
            ConfigUpdate {
                model: input.model.clone(),
                permission_mode: input.permission_mode,
                ..Default::default()
            },
            &|fresh| check_current(client, chat, input, fresh),
        )
        .await
        .map_err(|_| {
            ToolError::invalid(
                "Chat changed or configuration was refused; read it again before retrying",
            )
        })?;

    Ok(())
}
