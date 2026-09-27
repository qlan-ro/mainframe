use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Response,
};
use serde::Deserialize;

use crate::{
    ctx::AppCtx,
    respond::{fail, ok},
};

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ModelQuery {
    project_id: Option<String>,
    chat_id: Option<String>,
}

pub(super) async fn resolve(
    State(ctx): State<Arc<AppCtx>>,
    Path(adapter_id): Path<String>,
    Query(query): Query<ModelQuery>,
) -> Response {
    let Some(adapter) = ctx.adapter_registry.get(&adapter_id) else {
        return fail(StatusCode::NOT_FOUND, "Adapter not found");
    };
    if let Some(id) = &query.chat_id {
        return observed_model(&ctx, &adapter_id, id, query.project_id.as_deref()).await;
    }
    let cwd = match project_path(&ctx, query.project_id).await {
        Ok(path) => path,
        Err(response) => return response,
    };
    let key = format!("{adapter_id}.executablePath");
    let executable = match ctx
        .db
        .call(move |db| db.settings.get("provider", &key))
        .await
    {
        Ok(value) => value.filter(|value| !value.is_empty()),
        Err(err) => return crate::async_err::internal_error("get provider executable", &err),
    };
    ok(adapter.configured_model(cwd, executable).await)
}

async fn observed_model(
    ctx: &AppCtx,
    adapter_id: &str,
    chat_id: &str,
    project_id: Option<&str>,
) -> Response {
    let Some(manager) = ctx.chat_manager.as_ref() else {
        return fail(StatusCode::NOT_FOUND, "Chat not found");
    };
    let Some(chat) = manager.get_chat(chat_id) else {
        return fail(StatusCode::NOT_FOUND, "Chat not found");
    };
    if chat.adapter_id != adapter_id || project_id.is_some_and(|id| id != chat.project_id) {
        return fail(
            StatusCode::BAD_REQUEST,
            "Chat does not match adapter and project",
        );
    }
    let Some(session) = manager
        .get_session_for_chat(chat_id)
        .filter(|s| s.is_spawned())
    else {
        return ok(None::<String>);
    };
    let model = session.effective_model().await;
    let unchanged = session.is_spawned()
        && manager
            .get_session_for_chat(chat_id)
            .is_some_and(|current| Arc::ptr_eq(&current, &session));
    ok(if unchanged { model } else { None })
}

async fn project_path(ctx: &AppCtx, id: Option<String>) -> Result<String, Response> {
    let Some(id) = id else {
        return dirs::home_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .ok_or_else(|| {
                fail(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Home directory unavailable",
                )
            });
    };
    match ctx.db.call(move |db| db.projects.get(&id)).await {
        Ok(Some(project)) => Ok(project.path),
        Ok(None) => Err(fail(StatusCode::NOT_FOUND, "Project not found")),
        Err(err) => Err(crate::async_err::internal_error("get project", &err)),
    }
}
