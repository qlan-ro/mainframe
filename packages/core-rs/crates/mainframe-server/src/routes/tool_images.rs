use std::sync::Arc;

use crate::{
    ctx::AppCtx,
    respond::{ApiError, ok},
};
use axum::{
    Router,
    extract::{Path, Query, State},
    response::Response,
    routing::get,
};
use serde::Deserialize;

/// `agent` names the sub-agent whose transcript holds the tool call; without it
/// the image is looked up in the chat's own history.
#[derive(Deserialize, Default)]
pub(crate) struct SubagentQuery {
    pub(crate) agent: Option<String>,
}

async fn get_image(
    State(ctx): State<Arc<AppCtx>>,
    Path((chat_id, tool_id, index)): Path<(String, String, usize)>,
    Query(query): Query<SubagentQuery>,
) -> Result<Response, ApiError> {
    if !mainframe_types::ids::is_safe_identifier(&chat_id)
        || !mainframe_types::ids::is_safe_identifier(&tool_id)
        || query
            .agent
            .as_deref()
            .is_some_and(|agent| !mainframe_types::ids::is_safe_identifier(agent))
    {
        return Err(ApiError::BadRequest("Invalid parameters".into()));
    }
    ctx.require_chat(&chat_id).await?;
    let chats = &ctx.chat.chat_manager;
    let image = match query.agent {
        Some(agent) => {
            chats
                .get_subagent_tool_image(&chat_id, agent, &tool_id, index)
                .await
        }
        None => chats.get_tool_result_image(&chat_id, &tool_id, index).await,
    };
    let image = image.ok_or_else(|| ApiError::NotFound("Tool image not available".into()))?;
    Ok(ok(image))
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route(
        "/api/chats/{id}/tool-result/{tool_id}/images/{index}",
        get(get_image),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::read_json;
    use axum::http::StatusCode;

    #[tokio::test]
    async fn validates_image_lookup_identifiers_and_missing_chats() {
        let ctx = AppCtx::test_ctx();
        let (status, _) = read_json(
            get_image(
                State(ctx.clone()),
                Path(("chat".into(), "../escape".into(), 0)),
                Query(SubagentQuery::default()),
            )
            .await,
        )
        .await
        .unwrap();
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let (status, _) = read_json(
            get_image(
                State(ctx),
                Path(("missing-chat".into(), "tool_1".into(), 0)),
                Query(SubagentQuery::default()),
            )
            .await,
        )
        .await
        .unwrap();
        assert_eq!(status, StatusCode::NOT_FOUND);
    }
}
