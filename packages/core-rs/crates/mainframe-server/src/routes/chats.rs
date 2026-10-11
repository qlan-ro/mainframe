//! Chat registry reads, history, archive, and tuning updates through ChatManager.

use axum::response::IntoResponse;
use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, patch, post};
use serde::Deserialize;

use mainframe_adapter_claude::messages::session_files::extract_session_file_paths;
use mainframe_types::adapter::EffortLevel;
use mainframe_types::chat::Chat;
use mainframe_types::chat_patch::ChatPatch;
use mainframe_types::transcript::TranscriptLocation;

use crate::ctx::AppCtx;
use crate::respond::{ApiError, fail, ok};
use crate::routes::body::parse_body;
use crate::routes::chat_discard::refuse_if_temporary;

const TAG_ALLOWED: fn(char) -> bool = |c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-';

fn tag_ok(tag: &str) -> bool {
    !tag.is_empty() && tag.chars().all(TAG_ALLOWED)
}

fn split_csv(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

#[derive(Deserialize)]
pub(crate) struct ListQuery {
    pub(crate) project: Option<String>,
    pub(crate) tags: Option<String>,
    pub(crate) synthetic: Option<String>,
    #[serde(rename = "includeTemporary")]
    pub(crate) include_temporary: Option<bool>,
}

pub(crate) async fn list(State(ctx): State<Arc<AppCtx>>, Query(q): Query<ListQuery>) -> Response {
    // Every parsed tag must match [a-z0-9-]+ or the whole query 400s.
    let tags_all: Option<Vec<String>> = match &q.tags {
        Some(raw) => {
            let parts = split_csv(raw);
            if !parts.iter().all(|t| tag_ok(t)) {
                return fail(StatusCode::BAD_REQUEST, "Tag values must match [a-z0-9-]+");
            }
            Some(parts)
        }
        None => None,
    };
    let synth: Vec<String> = q.synthetic.as_deref().map(split_csv).unwrap_or_default();
    let has_worktree = synth.iter().any(|s| s == "has-worktree");
    let include_temporary = q.include_temporary.unwrap_or(false);
    crate::respond::storage(ctx.chat.chat_manager.list_filtered(
        q.project.as_deref(),
        tags_all.as_deref(),
        has_worktree,
        true,
        include_temporary,
    ))
}

#[derive(Deserialize)]
pub(crate) struct ListForProjectQuery {
    #[serde(rename = "includeTemporary")]
    pub(crate) include_temporary: Option<bool>,
}

/// `ChatsRepository::list` (backing both the facade and db paths here) is the
/// SAME unfiltered read `remove_project` uses internally, so it must keep
/// returning temporary chats; this route filters the result itself instead of
/// adding a filter to that shared read. Also drops a side chat (temporary with
/// a parent) even with `include_temporary` set — `list`'s DB-layer filter
/// already excludes it.
fn filter_temporary(chats: Vec<Chat>, include_temporary: bool) -> Vec<Chat> {
    let is_side_chat =
        |c: &Chat| c.temporary && c.parent_chat_id.as_ref().is_some_and(|p| p.is_some());
    chats
        .into_iter()
        .filter(|c| !is_side_chat(c) && (include_temporary || !c.temporary))
        .collect()
}

pub(crate) async fn list_for_project(
    State(ctx): State<Arc<AppCtx>>,
    Path(project_id): Path<String>,
    Query(q): Query<ListForProjectQuery>,
) -> Response {
    let include_temporary = q.include_temporary.unwrap_or(false);
    crate::respond::storage(
        ctx.chat
            .chat_manager
            .list_chats(&project_id)
            .map(|chats| filter_temporary(chats, include_temporary)),
    )
}

pub(crate) async fn get_one(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    match ctx.chat.chat_manager.try_get_chat(&id) {
        Ok(Some(chat)) => ok(chat),
        Ok(None) => crate::respond::ApiError::chat_not_found().into_response(),
        Err(error) => crate::respond::ApiError::from(error).into_response(),
    }
}

#[derive(Deserialize)]
struct ArchiveQuery {
    #[serde(rename = "deleteWorktree")]
    delete_worktree: Option<String>,
}

async fn archive(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ArchiveQuery>,
) -> Response {
    let delete_worktree = q.delete_worktree.as_deref() != Some("false");
    let cm = &ctx.chat.chat_manager;
    if let Some(chat) = cm.get_chat(&id)
        && let Some(resp) = refuse_if_temporary(&chat, "archive")
    {
        return resp;
    }
    cm.archive_chat(&id, delete_worktree).await;
    crate::respond::ok_empty()
}

async fn messages(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    let cm = &ctx.chat.chat_manager;
    let mut payload = cm.get_display_messages(&id).await;
    payload.workflow_runs =
        crate::routes::chat_workflow_runs::workflow_runs_for_chat(&ctx, &id).await;
    ok(payload)
}

/// The desktop's facade path seeds `workflowRuns` from here — its transcript
/// comes over `/acp/{profile}` resume, which has no history-payload fold.
async fn workflow_runs(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    ok(crate::routes::chat_workflow_runs::workflow_runs_for_chat(&ctx, &id).await)
}

async fn pending_permission(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    if id.is_empty() {
        return fail(
            StatusCode::BAD_REQUEST,
            "String must contain at least 1 character(s)",
        );
    }
    let cm = &ctx.chat.chat_manager;
    let permission = cm.get_pending_permission(&id).await;
    ok(permission)
}

#[derive(Deserialize)]
struct TitleBody {
    title: Option<String>,
}

async fn set_title(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Response, ApiError> {
    let title = match parse_body::<TitleBody>(&body).and_then(|b| b.title) {
        Some(t) if !t.trim().is_empty() => t.trim().to_string(),
        _ => return Err(ApiError::BadRequest("Title is required".into())),
    };
    {
        let cm = &ctx.chat.chat_manager;
        cm.rename_chat(&id, &title);
    }
    Ok(ok(ctx.require_chat(&id).await?))
}

#[derive(Deserialize)]
struct PinnedBody {
    pinned: Option<bool>,
}

async fn set_pinned(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Response, ApiError> {
    let Some(pinned) = parse_body::<PinnedBody>(&body).and_then(|b| b.pinned) else {
        return Err(ApiError::BadRequest("pinned (boolean) is required".into()));
    };
    let lookup = id.clone();
    let existing = ctx.require_chat(&lookup).await?;
    if let Some(resp) = refuse_if_temporary(&existing, "pin") {
        return Ok(resp);
    }
    let cid = id.clone();
    if let Err(err) = ctx
        .core
        .db
        .call(move |db| {
            db.chats.update(
                &cid,
                &ChatPatch {
                    pinned: Some(pinned),
                    ..Default::default()
                },
            )
        })
        .await
    {
        return Err(ApiError::internal("update pinned", err));
    }
    let lookup = id.clone();
    let chat = ctx.require_chat(&lookup).await?;
    {
        let cm = &ctx.chat.chat_manager;
        cm.sync_chat_fields(
            &id,
            ChatPatch {
                pinned: Some(pinned),
                ..Default::default()
            },
        );
    }
    Ok(ok(chat))
}

fn parse_effort_field(v: &serde_json::Value) -> Result<Option<EffortLevel>, ()> {
    match v {
        serde_json::Value::Null => Ok(None),
        serde_json::Value::String(_) => serde_json::from_value(v.clone()).map(Some).map_err(|_| ()),
        _ => Err(()),
    }
}

fn parse_nullable_bool_field(v: &serde_json::Value) -> Result<Option<bool>, ()> {
    match v {
        serde_json::Value::Null => Ok(None),
        serde_json::Value::Bool(b) => Ok(Some(*b)),
        _ => Err(()),
    }
}

/// Build a tri-state `ChatPatch` from a raw JSON tuning object. Only present keys
/// are written (undefined skipped); `null` writes SQL NULL. Returns `Err` on any
/// ill-typed field so the caller emits the route's 400.
fn tuning_update(obj: &serde_json::Map<String, serde_json::Value>) -> Result<ChatPatch, ()> {
    let mut update = ChatPatch::default();
    if let Some(v) = obj.get("effort") {
        update.tuning.effort = Some(parse_effort_field(v)?);
    }
    if let Some(v) = obj.get("fast") {
        update.tuning.fast = Some(parse_nullable_bool_field(v)?);
    }
    if let Some(v) = obj.get("ultracode") {
        update.tuning.ultracode = Some(parse_nullable_bool_field(v)?);
    }
    if let Some(v) = obj.get("adaptiveThinking") {
        update.tuning.adaptive_thinking = Some(parse_nullable_bool_field(v)?);
    }
    Ok(update)
}

/// Persist the RAW tuning partial (tri-state), fetch the chat, then run the facade
/// follow-ups — `sync_chat_fields` (mirror the cache), fire-and-forget
/// `apply_tuning` (live re-apply, no-op without a session), `emit_chat_updated`
/// (broadcast).
async fn apply_and_return(
    ctx: &Arc<AppCtx>,
    id: String,
    update: ChatPatch,
) -> Result<Response, ApiError> {
    let partial = update.clone();
    let cid = id.clone();
    if let Err(err) = ctx
        .core
        .db
        .call(move |db| db.chats.update(&cid, &update))
        .await
    {
        return Err(ApiError::internal("update tuning", err));
    }
    let lookup = id.clone();
    let chat = ctx.require_chat(&lookup).await?;
    {
        let cm = ctx.chat.chat_manager.clone();
        cm.sync_chat_fields(&id, partial);
        let (apply_cm, apply_id) = (cm.clone(), id.clone());
        tokio::spawn(async move { apply_cm.apply_tuning(&apply_id).await });
        cm.emit_chat_updated(&id);
    }
    Ok(ok(chat))
}

async fn set_tuning(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let Some(obj) = parse_body::<serde_json::Value>(&body).and_then(|v| v.as_object().cloned())
    else {
        return fail(StatusCode::BAD_REQUEST, "invalid tuning payload");
    };
    let Ok(update) = tuning_update(&obj) else {
        return fail(StatusCode::BAD_REQUEST, "invalid tuning payload");
    };
    apply_and_return(&ctx, id, update).await.into_response()
}

async fn set_effort(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let Some(obj) = parse_body::<serde_json::Value>(&body).and_then(|v| v.as_object().cloned())
    else {
        return fail(
            StatusCode::BAD_REQUEST,
            "effort must be a valid level or null",
        );
    };
    let Some(raw) = obj.get("effort") else {
        return fail(
            StatusCode::BAD_REQUEST,
            "effort must be a valid level or null",
        );
    };
    let Ok(effort) = parse_effort_field(raw) else {
        return fail(
            StatusCode::BAD_REQUEST,
            "effort must be a valid level or null",
        );
    };
    let update = ChatPatch {
        tuning: mainframe_types::chat::SessionTuning {
            effort: Some(effort),
            ..Default::default()
        },
        ..Default::default()
    };
    apply_and_return(&ctx, id, update).await.into_response()
}

async fn unarchive(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    let cm = &ctx.chat.chat_manager;
    if let Some(chat) = cm.get_chat(&id)
        && let Some(resp) = refuse_if_temporary(&chat, "unarchive")
    {
        return resp;
    }
    match cm.unarchive_chat(&id) {
        Some(chat) => ok(chat),
        None => crate::respond::ApiError::chat_not_found().into_response(),
    }
}

async fn session_files(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    let cm = &ctx.chat.chat_manager;
    // Load from disk to include subagent file changes absent from the in-memory
    // cache during an active session.
    let messages = cm.get_messages_from_disk(&id).await;
    let files = extract_session_file_paths(&messages);
    ok(serde_json::json!({ "files": files }))
}

async fn tool_result(
    State(ctx): State<Arc<AppCtx>>,
    Path((id, tool_use_id)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    if id.is_empty() || !mainframe_types::ids::is_safe_identifier(&tool_use_id) {
        return Err(ApiError::BadRequest("Invalid parameters".into()));
    }
    let lookup_id = id.clone();
    let chat = ctx.require_chat(&lookup_id).await?;

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
            tracing::warn!(chat_id = %chat.id, %err, "tool result transcript lookup failed");
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

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/chats", get(list))
        .route("/api/projects/{projectId}/chats", get(list_for_project))
        .route("/api/chats/{id}", get(get_one))
        .route("/api/chats/{id}/archive", post(archive))
        .route("/api/chats/{id}/messages", get(messages))
        .route("/api/chats/{id}/workflow-runs", get(workflow_runs))
        .route(
            "/api/chats/{id}/pending-permission",
            get(pending_permission),
        )
        .route("/api/chats/{id}/title", patch(set_title))
        .route("/api/chats/{id}/pinned", patch(set_pinned))
        .route("/api/chats/{id}/tuning", patch(set_tuning))
        .route("/api/chats/{id}/effort", patch(set_effort))
        .route("/api/chats/{id}/unarchive", post(unarchive))
        .route("/api/chats/{id}/session-files", get(session_files))
        .route("/api/chats/{id}/tool-result/{toolUseId}", get(tool_result))
}

#[cfg(test)]
#[path = "chats_tests.rs"]
mod tests;
