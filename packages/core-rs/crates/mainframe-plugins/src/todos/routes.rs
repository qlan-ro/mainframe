//! The CRUD, move and start-session handlers. Each handler validates the body,
//! writes through `repo`, stamps the GitHub touch map, and answers with the
//! re-read row so the response is exactly what was persisted.

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Json, Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use mainframe_types::time::now_iso8601;
use serde_json::{Value, json};

use super::input::{CreateTodo, MoveTodo, PatchTodo};
use super::repo;
use super::respond::{bad_request, json_response, not_found, server_error};
use super::types::{Todo, TodoStatus};
use crate::PluginError;
use crate::context::{CreateChatArgs, NotifyOptions, PluginContext};
use crate::todos_github::touch;

pub(super) async fn get_todos(
    State(ctx): State<Arc<PluginContext>>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let Some(project_id) = params.get("projectId") else {
        return bad_request("projectId required");
    };
    match repo::list(&ctx, project_id).await {
        Ok(todos) => json_response(StatusCode::OK, json!({ "todos": todos })),
        Err(err) => server_error(err),
    }
}

pub(crate) async fn post_todo(
    State(ctx): State<Arc<PluginContext>>,
    Json(body): Json<Value>,
) -> Response {
    let Some(input) = CreateTodo::parse(body) else {
        return bad_request("Invalid input");
    };
    let now = now_iso8601();
    let id = nanoid::nanoid!();
    if let Err(err) = repo::insert(&ctx, &id, input, &now).await {
        return server_error(err);
    }
    if let Err(err) = touch::stamp_create(&ctx, &id, &now).await {
        return server_error(err);
    }
    match repo::fetch(&ctx, &id).await {
        Ok(Some(todo)) => json_response(StatusCode::CREATED, json!({ "todo": todo })),
        Ok(None) => server_error(PluginError::Message("inserted row not found".into())),
        Err(err) => server_error(err),
    }
}

pub(crate) async fn patch_todo(
    State(ctx): State<Arc<PluginContext>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let existing = match repo::fetch(&ctx, &id).await {
        Ok(Some(todo)) => todo,
        Ok(None) => return not_found(),
        Err(err) => return server_error(err),
    };
    let Some(patch) = PatchTodo::parse(&body) else {
        return bad_request("Invalid input");
    };
    let now = now_iso8601();
    if let Err(err) = repo::update(&ctx, &id, &patch, &now).await {
        return server_error(err);
    }
    if let Err(err) = touch::stamp_patch(&ctx, &id, &existing, &patch, &now).await {
        return server_error(err);
    }
    let updated = match repo::fetch(&ctx, &id).await {
        Ok(Some(todo)) => todo,
        Ok(None) => return not_found(),
        Err(err) => return server_error(err),
    };
    if let Some(status) = &patch.status
        && *status != existing.status
    {
        ctx.ui.notify(NotifyOptions {
            title: format!("#{} {}", updated.number, updated.title),
            body: format!("Moved to {}", status.label()),
            level: Some("success".to_string()),
        });
    }
    json_response(StatusCode::OK, json!({ "todo": updated }))
}

pub(crate) async fn move_todo(
    State(ctx): State<Arc<PluginContext>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let Some(MoveTodo { status }) = MoveTodo::parse(body) else {
        return bad_request("Invalid status");
    };
    let previous = match repo::fetch(&ctx, &id).await {
        Ok(Some(todo)) => todo.status,
        Ok(None) => return not_found(),
        Err(err) => return server_error(err),
    };
    let now = now_iso8601();
    if let Err(err) = repo::set_status(&ctx, &id, &status, &now).await {
        return server_error(err);
    }
    if let Err(err) = touch::stamp_move(&ctx, &id, &previous, &status, &now).await {
        return server_error(err);
    }
    let todo = match repo::fetch(&ctx, &id).await {
        Ok(Some(todo)) => todo,
        Ok(None) => return not_found(),
        Err(err) => return server_error(err),
    };
    if let Err(err) = warn_open_dependencies(&ctx, &todo).await {
        return server_error(err);
    }
    json_response(StatusCode::OK, json!({ "todo": todo }))
}

/// Closing a todo whose dependencies are still open raises a warning
/// notification; the move itself is never blocked.
async fn warn_open_dependencies(ctx: &PluginContext, todo: &Todo) -> Result<(), PluginError> {
    if todo.status != TodoStatus::Done || todo.dependencies.is_empty() {
        return Ok(());
    }
    let open = repo::dependencies(ctx, todo)
        .await?
        .into_iter()
        .filter(|dependency| dependency.status != TodoStatus::Done)
        .map(|dependency| format!("#{} {}", dependency.number, dependency.title))
        .collect::<Vec<_>>();
    if !open.is_empty() {
        ctx.ui.notify(NotifyOptions {
            title: format!("#{} {} has open dependencies", todo.number, todo.title),
            body: open.join(", "),
            level: Some("warning".to_string()),
        });
    }
    Ok(())
}

pub(crate) async fn delete_todo(
    State(ctx): State<Arc<PluginContext>>,
    Path(id): Path<String>,
) -> Response {
    if let Err(err) = touch::clear_for_todo(&ctx, &id).await {
        return server_error(err);
    }
    match repo::delete(&ctx, &id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => server_error(err),
    }
}

pub(super) async fn start_session(
    State(ctx): State<Arc<PluginContext>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let todo = match repo::fetch(&ctx, &id).await {
        Ok(Some(todo)) => todo,
        Ok(None) => return not_found(),
        Err(err) => return server_error(err),
    };
    let Some(project_id) = body.get("projectId").and_then(Value::as_str) else {
        return bad_request("projectId required");
    };
    if !ctx.chats.can_create_chat() {
        return json_response(
            StatusCode::FORBIDDEN,
            json!({ "error": "chat:create capability required" }),
        );
    }
    let dependencies = match repo::dependencies(&ctx, &todo).await {
        Ok(dependencies) => dependencies,
        Err(err) => return server_error(err),
    };
    let args = CreateChatArgs {
        project_id: project_id.to_string(),
        ..Default::default()
    };
    match ctx.chats.create_chat(args).await {
        Ok(result) => json_response(
            StatusCode::OK,
            json!({
                "chatId": result.chat_id,
                "initialMessage": build_initial_message(&todo, &dependencies),
            }),
        ),
        Err(err) => server_error(err),
    }
}

/// The first chat message for a todo: heading, metadata line, optional
/// milestone and dependency lines, then the body under `## Description`.
fn build_initial_message(todo: &Todo, dependencies: &[Todo]) -> String {
    let labels = if todo.labels.is_empty() {
        "none".to_string()
    } else {
        todo.labels.join(", ")
    };
    let mut lines = vec![
        format!("**#{} {}**", todo.number, todo.title),
        format!(
            "Type: {} | Priority: {} | Labels: {}",
            capitalize(todo.type_field.as_str()),
            capitalize(todo.priority.as_str()),
            labels
        ),
    ];
    if let Some(milestone) = &todo.milestone {
        lines.push(format!("Milestone: {milestone}"));
    }
    if !dependencies.is_empty() {
        let summary = dependencies
            .iter()
            .map(|d| format!("#{} {} ({})", d.number, d.title, d.status.as_str()))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("Dependencies: {summary}"));
    }
    if !todo.body.is_empty() {
        lines.push(String::new());
        lines.push("## Description".to_string());
        lines.push(todo.body.clone());
    }
    lines.join("\n")
}

fn capitalize(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}
