//! What a session changed, read from its transcript rather than from git: the
//! review modal's Session scope. Paths are relative to the chat's effective
//! path (its worktree when it has one); files outside it are dropped.
//!
//! - `GET /api/chats/:id/session-files` — every file the session wrote or
//!   edited, with a status: `added` when the session created it, `deleted` when
//!   it no longer exists, `modified` otherwise.
//! - `GET /api/chats/:id/session-diff?file=` — that file before the session's
//!   first edit and after its last (`source: "session"`). When the edits cannot
//!   be replayed (a patch no longer matches the file, which later work
//!   changed), the file at the last commit before the session started against
//!   the working tree instead (`source: "git"`).

use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::get;
use mainframe_runtime::fs::resolve_and_validate_path;
use mainframe_types::chat::ChatMessage;
use serde::Deserialize;
use serde_json::json;

use crate::ctx::AppCtx;
use crate::fs_utils::relative_within;
use crate::respond::{ApiError, ok};
use crate::routes::git::resolve_chat_path;
use crate::session_edits::{file_edits, reconstruct};

/// The chat's effective path plus its transcript, loaded from disk so subagent
/// edits absent from the in-memory cache during an active session are included.
/// `None` for a chat with no resolvable path.
async fn load(ctx: &AppCtx, chat_id: &str) -> Result<Option<(String, Vec<ChatMessage>)>, ApiError> {
    let Some(base) = resolve_chat_path(ctx, chat_id).await? else {
        return Ok(None);
    };
    let messages = ctx.chat.chat_manager.get_messages_from_disk(chat_id).await;
    Ok(Some((base, messages)))
}

/// Whether `file` (already `base`-relative) exists on disk now. A session may
/// have deleted it, or its whole directory.
async fn exists(base: &str, file: &str) -> bool {
    tokio::fs::try_exists(std::path::Path::new(base).join(file))
        .await
        .unwrap_or(false)
}

/// The file on disk now, `None` when it no longer exists. Confined lexically
/// first, since a missing file cannot be canonicalized, then by its real path
/// when it exists, so a symlink cannot lead outside the project.
async fn read_working(base: &str, file: &str) -> Result<Option<String>, ApiError> {
    let outside = || ApiError::new(StatusCode::FORBIDDEN, "Path outside project");
    if relative_within(base, file).is_none() {
        return Err(outside());
    }
    if !exists(base, file).await {
        return Ok(None);
    }
    let resolved = resolve_and_validate_path(base, file)
        .await
        .ok_or_else(outside)?;
    Ok(tokio::fs::read_to_string(&resolved).await.ok())
}

async fn session_files(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let Some((base, messages)) = load(&ctx, &id).await? else {
        return Ok(ok(json!({ "files": [] })));
    };
    let mut files = Vec::new();
    for (path, edits) in file_edits(&messages, &base) {
        let status = if !exists(&base, &path).await {
            "deleted"
        } else if edits.first().is_some_and(|edit| edit.creates_file()) {
            "added"
        } else {
            "modified"
        };
        files.push(json!({ "path": path, "status": status }));
    }
    Ok(ok(json!({ "files": files })))
}

#[derive(Debug, Deserialize)]
struct SessionDiffQuery {
    file: String,
}

async fn session_diff(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<SessionDiffQuery>,
) -> Result<Response, ApiError> {
    let (base, messages) = load(&ctx, &id)
        .await?
        .ok_or_else(ApiError::chat_not_found)?;
    let working = read_working(&base, &q.file).await?;
    let edits = file_edits(&messages, &base)
        .into_iter()
        .find_map(|(path, edits)| (path == q.file).then_some(edits))
        .unwrap_or_default();
    if let Some((original, modified)) = reconstruct(&edits, working.as_deref()) {
        return Ok(ok(
            json!({ "original": original, "modified": modified, "source": "session" }),
        ));
    }
    let started_at = ctx.require_chat(&id).await?.created_at;
    let git = ctx.core.git.for_project(base.clone());
    // No commit that old: the file did not exist when the session started.
    let original = match git.last_commit_before(&started_at).await {
        Ok(Some(commit)) => git
            .show(&format!("{commit}:{}", q.file))
            .await
            .unwrap_or_default(),
        Ok(None) => String::new(),
        Err(error) => {
            tracing::warn!(error = %error, chat_id = %id, "Failed to find the session's start commit");
            String::new()
        }
    };
    Ok(ok(
        json!({ "original": original, "modified": working.unwrap_or_default(), "source": "git" }),
    ))
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/chats/{id}/session-files", get(session_files))
        .route("/api/chats/{id}/session-diff", get(session_diff))
}
