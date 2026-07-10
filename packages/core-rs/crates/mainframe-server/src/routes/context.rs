//! Ported from `src/server/routes/context.ts` — session context, session-file
//! content read, and add-mention.
//!
//! `session-file` ports fully (getChat/project via db + `resolve_readable_path` +
//! async file read). `mentions` persists via `db.chats.add_mention` and returns
//! the built mention; the TS `ctx.chats.addMention` also emits a context event —
//! that WS side effect is a TODO(port) because the emitting facade method is not
//! on the Rust ChatManager yet. `context` (getSessionContext) needs the
//! context-tracker facade method and is a Phase-4 seam mirroring projects::remove.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, post};
use serde::Deserialize;

use mainframe_runtime::time::now_iso8601;
use mainframe_types::context::{MentionKind, MentionSource, SessionMention};

use crate::ctx::AppCtx;
use crate::path_utils::resolve_readable_path;
use crate::respond::{fail, ok};
use crate::routes::projects::parse_body;

async fn context(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    // getChat/project resolution ports over db; getSessionContext itself is the
    // context-tracker facade method not yet on the Rust ChatManager.
    let lookup = id.clone();
    match ctx.db.call(move |db| db.chats.get(&lookup)).await {
        Ok(Some(_)) => {}
        Ok(None) => return fail(StatusCode::NOT_FOUND, "Chat not found"),
        Err(err) => return crate::async_err::internal_error("get chat", &err),
    }
    tracing::warn!(chat_id = %id, "getSessionContext is a Phase-4 seam (ChatManager.getSessionContext unavailable)");
    fail(StatusCode::INTERNAL_SERVER_ERROR, "Operation failed")
}

#[derive(Deserialize)]
struct SessionFileQuery {
    path: Option<String>,
}

async fn session_file(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<SessionFileQuery>,
) -> Response {
    let lookup = id.clone();
    let chat = match ctx.db.call(move |db| db.chats.get(&lookup)).await {
        Ok(Some(chat)) => chat,
        Ok(None) => return fail(StatusCode::NOT_FOUND, "Chat not found"),
        Err(err) => return crate::async_err::internal_error("get chat", &err),
    };
    let project_id = chat.project_id.clone();
    let project = match ctx.db.call(move |db| db.projects.get(&project_id)).await {
        Ok(Some(project)) => project,
        Ok(None) => return fail(StatusCode::NOT_FOUND, "Project not found"),
        Err(err) => return crate::async_err::internal_error("get project", &err),
    };
    let Some(file_path) = q.path.filter(|p| !p.is_empty()) else {
        return fail(StatusCode::BAD_REQUEST, "path query required");
    };

    let session_base = chat.worktree_path.clone().unwrap_or(project.path);
    let Some(full_path) = resolve_readable_path(&session_base, &file_path).await else {
        return fail(StatusCode::FORBIDDEN, "Path outside project");
    };
    match tokio::fs::read_to_string(&full_path).await {
        Ok(content) => ok(serde_json::json!({ "path": file_path, "content": content })),
        Err(err) => {
            tracing::warn!(path = %file_path, %err, "Failed to read session file");
            fail(StatusCode::NOT_FOUND, "File not found")
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
    // Persist via db; the TS ctx.chats.addMention also emits a context event —
    // TODO(port-phase4): emit once the ChatManager context-tracker facade lands.
    let (cid, m) = (id, mention.clone());
    if let Err(err) = ctx.db.call(move |db| db.chats.add_mention(&cid, &m)).await {
        return crate::async_err::internal_error("add mention", &err);
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

    async fn read(resp: Response) -> (StatusCode, serde_json::Value) {
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

// PORT STATUS: src/server/routes/context.ts (3 endpoints, 93 lines)
// confidence: medium
// todos: 2
// notes: session-file ported fully (db chat/project + resolve_readable_path + async
// read_to_string). mentions persists via db.chats.add_mention and returns the
// nanoid mention; the TS event emit is a TODO(port) pending the context-tracker
// facade method. context (getSessionContext) is a Phase-4 seam mirroring
// projects::remove — the facade method is not yet on the Rust ChatManager.
