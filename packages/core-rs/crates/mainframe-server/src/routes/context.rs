use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, post};
use serde::Deserialize;

use mainframe_types::context::{MentionKind, MentionSource, SessionMention};
use mainframe_types::time::now_iso8601;

use crate::ctx::AppCtx;
use crate::path_utils::resolve_readable_path;
use crate::respond::{ApiError, fail, ok};
use crate::routes::body::parse_body;

async fn context(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let lookup = id.clone();
    let chat = ctx.require_chat(&lookup).await?;
    let project_id = chat.project_id.clone();
    let project = ctx.require_project(&project_id).await?;
    let cm = &ctx.chat.chat_manager;
    let effective_path = chat.worktree_path.clone().unwrap_or(project.path);
    Ok(ok(cm.get_session_context(&id, &effective_path).await?))
}

#[derive(Deserialize)]
struct SessionFileQuery {
    path: Option<String>,
}

async fn session_file(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<SessionFileQuery>,
) -> Result<Response, ApiError> {
    let lookup = id.clone();
    let chat = ctx.require_chat(&lookup).await?;
    let project_id = chat.project_id.clone();
    let project = ctx.require_project(&project_id).await?;
    let Some(file_path) = q.path.filter(|p| !p.is_empty()) else {
        return Err(ApiError::BadRequest("path query required".into()));
    };

    let session_base = chat.worktree_path.clone().unwrap_or(project.path);
    let Some(full_path) = resolve_readable_path(&session_base, &file_path).await else {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "Path outside project"));
    };
    match tokio::fs::read_to_string(&full_path).await {
        Ok(content) => Ok(ok(
            serde_json::json!({ "path": file_path, "content": content }),
        )),
        Err(err) => {
            tracing::warn!(path = %file_path, %err, "Failed to read session file");
            Err(ApiError::NotFound("File not found".into()))
        }
    }
}

#[derive(Deserialize)]
struct AddMentionBody {
    kind: Option<String>,
    name: Option<String>,
    path: Option<String>,
}

async fn add_mention(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let Some(b) = parse_body::<AddMentionBody>(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    let kind = match b.kind.as_deref() {
        Some("file") => MentionKind::File,
        Some("agent") => MentionKind::Agent,
        _ => return fail(StatusCode::BAD_REQUEST, "kind must be file or agent"),
    };
    let Some(name) = b.name.filter(|n| !n.is_empty()) else {
        return fail(StatusCode::BAD_REQUEST, "name is required");
    };
    let mention = SessionMention {
        id: nanoid::nanoid!(),
        kind,
        source: MentionSource::User,
        name,
        path: b.path,
        timestamp: now_iso8601(),
    };
    {
        let cm = &ctx.chat.chat_manager;
        cm.add_mention(&id, mention.clone());
    }
    ok(mention)
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/chats/{id}/context", get(context))
        .route("/api/chats/{id}/session-file", get(session_file))
        .route("/api/chats/{id}/mentions", post(add_mention))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::response::IntoResponse;

    async fn read(resp: impl IntoResponse) -> (StatusCode, serde_json::Value) {
        let resp = resp.into_response();
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        )
    }

    #[tokio::test]
    async fn session_file_missing_chat_404() {
        let ctx = AppCtx::test_ctx();
        let resp = session_file(
            State(ctx.clone()),
            Path("nope".into()),
            Query(SessionFileQuery {
                path: Some("a.txt".into()),
            }),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"], "Chat not found");
    }

    #[tokio::test]
    async fn add_mention_rejects_bad_kind_400() {
        let ctx = AppCtx::test_ctx();
        let resp = add_mention(
            State(ctx.clone()),
            Path("c".into()),
            axum::body::Bytes::from(r#"{"kind":"nope","name":"x"}"#),
        )
        .await;
        assert_eq!(read(resp).await.0, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn context_missing_chat_404() {
        let ctx = AppCtx::test_ctx();
        let (status, body) = read(context(State(ctx.clone()), Path("nope".into())).await).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"], "Chat not found");
    }
}
