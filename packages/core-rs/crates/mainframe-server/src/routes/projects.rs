//! Ported from `src/server/routes/projects.ts` — project registry CRUD.
//!
//! Also hosts `parse_body`, the shared request-body parser the Phase-3 route
//! modules use: it treats an empty/whitespace body as `{}` (Express's
//! `express.json()` default) and yields `None` on malformed/ill-typed JSON so
//! each caller can emit its own 400 envelope string (matching each route's exact
//! Zod `safeParse` failure).

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use axum::routing::get;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::json;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok, ok_empty};

/// Parse `body` into `T`, treating an empty/whitespace body as `{}`. Returns
/// `None` on malformed JSON or a type mismatch — the caller maps that to its
/// route-specific 400 envelope (the TS `validate()`/`safeParse()` 400 path).
pub(crate) fn parse_body<T: DeserializeOwned>(body: &Bytes) -> Option<T> {
    let slice: &[u8] = if body.iter().all(u8::is_ascii_whitespace) {
        b"{}"
    } else {
        body
    };
    serde_json::from_slice(slice).ok()
}

#[derive(Deserialize)]
struct CreateProjectBody {
    path: String,
    name: Option<String>,
}

async fn list(State(ctx): State<Arc<AppCtx>>) -> Response {
    match ctx.db.call(|db| db.projects.list()).await {
        Ok(projects) => ok(projects),
        Err(err) => crate::async_err::internal_error("list projects", &err),
    }
}

async fn get_one(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    match ctx.db.call(move |db| db.projects.get(&id)).await {
        Ok(Some(project)) => ok(project),
        Ok(None) => fail(StatusCode::NOT_FOUND, "Project not found"),
        Err(err) => crate::async_err::internal_error("get project", &err),
    }
}

async fn create(State(ctx): State<Arc<AppCtx>>, body: Bytes) -> Response {
    let Some(parsed): Option<CreateProjectBody> = parse_body(&body) else {
        return fail(
            StatusCode::BAD_REQUEST,
            "Invalid input: expected string, received undefined",
        );
    };
    if parsed.path.is_empty() {
        return fail(
            StatusCode::BAD_REQUEST,
            "Too small: expected string to have >=1 characters",
        );
    }

    let path = parsed.path.clone();
    let existing = match ctx.db.call(move |db| db.projects.get_by_path(&path)).await {
        Ok(existing) => existing,
        Err(err) => return crate::async_err::internal_error("lookup project by path", &err),
    };
    if let Some(existing) = existing {
        return (
            StatusCode::CONFLICT,
            Json(json!({
                "success": false,
                "error": "Project already registered",
                "data": existing,
            })),
        )
            .into_response();
    }

    let path = parsed.path;
    let name = parsed.name;
    match ctx
        .db
        .call(move |db| db.projects.create(&path, name.as_deref()))
        .await
    {
        Ok(project) => ok(project),
        Err(err) => crate::async_err::internal_error("create project", &err),
    }
}

async fn remove(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    // The TS handler is `await ctx.chats.removeProject(id)` then `ok_empty()` —
    // ChatManager.removeProject stops the project's live sessions and tears down
    // its worktrees before deleting the row. When the ChatManager is unwired the
    // teardown cannot run, so the endpoint keeps the TS failure-path 500 envelope
    // (ChatManager construction is a documented blocker).
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(
            project_id = %id,
            "DELETE /api/projects/:id needs ChatManager.removeProject (unwired)"
        );
        return fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to remove project",
        );
    };
    cm.remove_project(&id).await;
    ok_empty()
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/projects", get(list).post(create))
        .route("/api/projects/{id}", get(get_one).delete(remove))
}

// PORT STATUS: src/server/routes/projects.ts (4 endpoints, 57 lines)
// confidence: medium
// todos: 1
// notes: GET list / GET :id / POST ported 1:1 over ctx.db.projects (list/get/
// get_by_path/create). POST's 409 carries `data: existing` (a non-standard fail
// envelope) so it is hand-built, not via `fail()`. CreateProjectBody path.min(1)
// → serde String + explicit non-empty check. DELETE :id is a Phase-4/5 seam:
// ChatManager.removeProject is not on AppCtx, so it logs a warn and returns the
// TS failure-path 500 string; see blockers.
