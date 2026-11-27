//! On-demand full tool results for previews the client was sent.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::response::Response;

use mainframe_types::chat::Chat;
use mainframe_types::chat_patch::ChatPatch;
use mainframe_types::transcript::TranscriptLocation;

use crate::ctx::AppCtx;
use crate::respond::{ApiError, ok};
use crate::routes::tool_images::SubagentQuery;

/// The full text of a tool result the client holds as a preview. `agent` names
/// the sub-agent whose transcript holds the call; without it the chat's own
/// transcript is read.
pub(super) async fn tool_result(
    State(ctx): State<Arc<AppCtx>>,
    Path((id, tool_use_id)): Path<(String, String)>,
    Query(query): Query<SubagentQuery>,
) -> Result<Response, ApiError> {
    if id.is_empty()
        || !mainframe_types::ids::is_safe_identifier(&tool_use_id)
        || query
            .agent
            .as_deref()
            .is_some_and(|agent| !mainframe_types::ids::is_safe_identifier(agent))
    {
        return Err(ApiError::BadRequest("Invalid parameters".into()));
    }
    let lookup_id = id.clone();
    let chat = ctx.require_chat(&lookup_id).await?;
    if let Some(agent) = query.agent {
        return ctx
            .chat
            .chat_manager
            .get_subagent_tool_result(&id, agent, &tool_use_id)
            .await
            .map(|content| ok(serde_json::json!({ "content": content })))
            .ok_or_else(|| ApiError::NotFound("Tool result not available".into()));
    }

    let file_path = match resolve_tool_result_path(&ctx, &chat).await {
        Ok(Some(path)) => path,
        Err(error) => return Err(error),
        Ok(None) => return Err(ApiError::NotFound("No session file for chat".into())),
    };
    let content = match ctx.core.adapter_registry.get(&chat.adapter_id) {
        Some(adapter) => adapter.read_tool_result(file_path, tool_use_id).await,
        None => None,
    };
    match content {
        Some(content) => Ok(ok(serde_json::json!({ "content": content }))),
        None => Err(ApiError::NotFound("Tool result not available".into())),
    }
}

async fn resolve_tool_result_path(
    ctx: &AppCtx,
    chat: &Chat,
) -> Result<Option<String>, crate::respond::ApiError> {
    if let Some(path) = &chat.session_file_path {
        return Ok(Some(path.clone()));
    }
    let Some(session_id) = &chat.vendor_session_id else {
        return Ok(None);
    };
    let project_id = chat.project_id.clone();
    let project_path = ctx
        .core
        .db
        .call(move |db| db.projects.get(&project_id))
        .await
        .map_err(|err| crate::respond::ApiError::internal("get project", &err))?
        .map(|project| project.path);
    let Some(cwd) = chat.worktree_path.clone().or(project_path) else {
        return Ok(None);
    };
    let Some(adapter) = ctx.core.adapter_registry.get(&chat.adapter_id) else {
        return Ok(None);
    };
    let location = match adapter
        .locate_transcript(session_id.clone(), cwd, None)
        .await
    {
        Ok(location) => location,
        Err(err) => {
            tracing::warn!(chat_id = %chat.id, error = %err, "tool result transcript lookup failed");
            None
        }
    };
    let Some(TranscriptLocation::Present(path)) = location else {
        return Ok(None);
    };
    let (cid, fp) = (chat.id.clone(), path.clone());
    ctx.core
        .db
        .call(move |db| {
            db.chats.update(
                &cid,
                &ChatPatch {
                    session_file_path: Some(fp),
                    ..Default::default()
                },
            )
        })
        .await
        .map_err(|err| crate::respond::ApiError::internal("persist session file path", &err))?;
    Ok(Some(path))
}
