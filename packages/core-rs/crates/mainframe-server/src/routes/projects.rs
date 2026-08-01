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

use mainframe_services::workspace::worktree::is_directory_present_async;
use mainframe_types::chat::Project;

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
        Ok(mut projects) => {
            for project in &mut projects {
                stamp_availability(project).await;
            }
            ok(projects)
        }
        Err(err) => crate::async_err::internal_error("list projects", &err),
    }
}

async fn get_one(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    match ctx.db.call(move |db| db.projects.get(&id)).await {
        Ok(Some(mut project)) => {
            stamp_availability(&mut project).await;
            ok(project)
        }
        Ok(None) => fail(StatusCode::NOT_FOUND, "Project not found"),
        Err(err) => crate::async_err::internal_error("get project", &err),
    }
}

async fn stamp_availability(project: &mut Project) {
    // Derived per response; never persisted.
    project.available = Some(is_directory_present_async(&project.path).await);
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

/// `ChatManager::remove_project`'s result → the route envelope. Split out
/// because the route harness cannot build a ChatManager to reach the Err arm.
fn removal_response(result: Result<(), String>) -> Response {
    match result {
        Ok(()) => ok_empty(),
        Err(err) => fail(StatusCode::INTERNAL_SERVER_ERROR, err),
    }
}

async fn remove(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    // ChatManager.remove_project stops the project's live sessions and tears
    // down its worktrees before deleting the row, then reports whether the row
    // delete itself succeeded so a failed delete answers with `fail()` instead
    // of a false `ok_empty()`. When the ChatManager is unwired the teardown
    // cannot run, so the endpoint keeps the TS failure-path 500 envelope
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
    removal_response(cm.remove_project(&id).await)
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/projects", get(list).post(create))
        .route("/api/projects/{id}", get(get_one).delete(remove))
}

#[cfg(test)]
mod tests {
    use axum::body::to_bytes;

    use super::*;

    async fn body_json(resp: Response) -> (StatusCode, serde_json::Value) {
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[tokio::test]
    async fn removal_response_ok_emits_the_empty_success_envelope() {
        let (status, body) = body_json(removal_response(Ok(()))).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, json!({ "success": true }));
    }

    #[tokio::test]
    async fn removal_response_err_emits_the_failure_envelope_with_the_message() {
        let (status, body) =
            body_json(removal_response(Err("database is locked".to_string()))).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            body,
            json!({ "success": false, "error": "database is locked" })
        );
    }
}

// PORT STATUS: src/server/routes/projects.ts (4 endpoints, 57 lines)
// confidence: medium
// todos: 0
// notes: GET list / GET :id / POST ported 1:1 over ctx.db.projects (list/get/
// get_by_path/create). POST's 409 carries `data: existing` (a non-standard fail
// envelope) so it is hand-built, not via `fail()`. CreateProjectBody path.min(1)
// → serde String + explicit non-empty check. DELETE :id calls the real
// ChatManager.remove_project (stops live sessions + tears down worktrees before
// the row delete) and maps its Result through `removal_response()`; unwired
// (Phase-3 harness) → the TS failure-path 500 string.
