//! Ported from `src/server/routes/chats.ts` — chat registry reads, archive,
//! title/pinned/tuning/effort PATCH, unarchive, messages/display-messages,
//! session-files and tool-result.
//!
//! Reads that the TS `ctx.chats.{listFiltered,listChats,getChat}` delegate 1:1 to
//! `this.db.chats` are ported straight over `ctx.db.chats` (behaviourally
//! identical). The pinned/tuning/effort PATCH routes mutate `ctx.db.chats.update`
//! directly in TS too, so they port fully; the optional `ctx.chats?.syncChatFields
//! ?.()`/`applyTuning?.()`/`emitChatUpdated?.()` follow-ups are best-effort in TS
//! (`?.`) and are skipped here because those delegating methods are not yet on the
//! Rust `ChatManager` facade (see PORT STATUS). Routes that require live-session
//! orchestration absent from the facade (archive, getDisplayMessages,
//! getMessagesFromDisk, getPendingPermission, unarchive) are Phase-4 seams
//! mirroring `projects::remove`.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, patch, post};
use serde::Deserialize;

use mainframe_chat::event_handler::compute_session_file_path;
use mainframe_db::chats::ChatListFilters;
use mainframe_types::adapter::EffortLevel;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok};
use crate::routes::projects::parse_body;

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
struct ListQuery {
    project: Option<String>,
    tags: Option<String>,
    synthetic: Option<String>,
}

async fn list(State(ctx): State<Arc<AppCtx>>, Query(q): Query<ListQuery>) -> Response {
    // Zod `.refine` — every parsed tag must match [a-z0-9-]+ or the whole query 400s.
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
    let filters = ChatListFilters {
        project_id: q.project,
        tags_all,
        has_worktree: synth.iter().any(|s| s == "has-worktree"),
        include_archived: true,
    };
    match ctx
        .db
        .call(move |db| db.chats.list_filtered(&filters))
        .await
    {
        Ok(chats) => ok(chats),
        Err(err) => crate::async_err::internal_error("list chats", &err),
    }
}

async fn list_for_project(
    State(ctx): State<Arc<AppCtx>>,
    Path(project_id): Path<String>,
) -> Response {
    match ctx.db.call(move |db| db.chats.list(&project_id)).await {
        Ok(chats) => ok(chats),
        Err(err) => crate::async_err::internal_error("list project chats", &err),
    }
}

async fn get_one(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    match ctx.db.call(move |db| db.chats.get(&id)).await {
        Ok(Some(chat)) => ok(chat),
        Ok(None) => fail(StatusCode::NOT_FOUND, "Chat not found"),
        Err(err) => crate::async_err::internal_error("get chat", &err),
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
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(chat_id = %id, "archive chat is a Phase-4 seam (ChatManager unavailable)");
        return fail(StatusCode::NOT_FOUND, "Operation failed");
    };
    cm.archive_chat(&id, delete_worktree).await;
    crate::respond::ok_empty()
}

async fn messages(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    // TODO(port-phase4): ctx.chats.getDisplayMessages(id) reads the MessageCache
    // display projection; the `get_display_messages` facade method is not yet on
    // the Rust ChatManager (message-cache accessors land with the server-integration
    // phase). Seam mirroring projects::remove.
    let _ = &ctx;
    tracing::warn!(chat_id = %id, "getDisplayMessages is a Phase-4 seam (ChatManager.getDisplayMessages unavailable)");
    fail(StatusCode::INTERNAL_SERVER_ERROR, "Operation failed")
}

async fn pending_permission(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    if id.is_empty() {
        return fail(
            StatusCode::BAD_REQUEST,
            "String must contain at least 1 character(s)",
        );
    }
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(chat_id = %id, "getPendingPermission is a Phase-4 seam (ChatManager unavailable)");
        return fail(StatusCode::INTERNAL_SERVER_ERROR, "Operation failed");
    };
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
) -> Response {
    let title = match parse_body::<TitleBody>(&body).and_then(|b| b.title) {
        Some(t) if !t.trim().is_empty() => t.trim().to_string(),
        _ => return fail(StatusCode::BAD_REQUEST, "Title is required"),
    };
    // Faithful path uses the facade rename (emits chat.updated); when the manager
    // is not wired yet (Phase-3 harness) the db write is the load-bearing effect.
    if let Some(cm) = ctx.chat_manager.as_ref() {
        cm.rename_chat(&id, &title);
    } else {
        let (cid, t) = (id.clone(), title.clone());
        if let Err(err) = ctx
            .db
            .call(move |db| {
                db.chats.update(
                    &cid,
                    &mainframe_db::chats::ChatUpdate {
                        title: Some(t),
                        ..Default::default()
                    },
                )
            })
            .await
        {
            return crate::async_err::internal_error("rename chat", &err);
        }
    }
    match ctx.db.call(move |db| db.chats.get(&id)).await {
        Ok(Some(chat)) => ok(chat),
        Ok(None) => fail(StatusCode::NOT_FOUND, "Chat not found"),
        Err(err) => crate::async_err::internal_error("get chat", &err),
    }
}

#[derive(Deserialize)]
struct PinnedBody {
    pinned: Option<bool>,
}

async fn set_pinned(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let Some(pinned) = parse_body::<PinnedBody>(&body).and_then(|b| b.pinned) else {
        return fail(StatusCode::BAD_REQUEST, "pinned (boolean) is required");
    };
    let cid = id.clone();
    if let Err(err) = ctx
        .db
        .call(move |db| {
            db.chats.update(
                &cid,
                &mainframe_db::chats::ChatUpdate {
                    pinned: Some(pinned),
                    ..Default::default()
                },
            )
        })
        .await
    {
        return crate::async_err::internal_error("update pinned", &err);
    }
    match ctx.db.call(move |db| db.chats.get(&id)).await {
        Ok(Some(chat)) => ok(chat),
        Ok(None) => fail(StatusCode::NOT_FOUND, "Chat not found"),
        Err(err) => crate::async_err::internal_error("get chat", &err),
    }
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

/// Build a tri-state `ChatUpdate` from a raw JSON tuning object. Only present keys
/// are written (undefined skipped); `null` writes SQL NULL. Returns `Err` on any
/// ill-typed field so the caller emits the route's 400.
fn tuning_update(
    obj: &serde_json::Map<String, serde_json::Value>,
) -> Result<mainframe_db::chats::ChatUpdate, ()> {
    let mut update = mainframe_db::chats::ChatUpdate::default();
    if let Some(v) = obj.get("effort") {
        update.effort = Some(parse_effort_field(v)?);
    }
    if let Some(v) = obj.get("fast") {
        update.fast = Some(parse_nullable_bool_field(v)?);
    }
    if let Some(v) = obj.get("ultracode") {
        update.ultracode = Some(parse_nullable_bool_field(v)?);
    }
    if let Some(v) = obj.get("adaptiveThinking") {
        update.adaptive_thinking = Some(parse_nullable_bool_field(v)?);
    }
    Ok(update)
}

async fn apply_and_return(
    ctx: &Arc<AppCtx>,
    id: String,
    update: mainframe_db::chats::ChatUpdate,
) -> Response {
    let cid = id.clone();
    if let Err(err) = ctx.db.call(move |db| db.chats.update(&cid, &update)).await {
        return crate::async_err::internal_error("update tuning", &err);
    }
    match ctx.db.call(move |db| db.chats.get(&id)).await {
        Ok(Some(chat)) => ok(chat),
        Ok(None) => fail(StatusCode::NOT_FOUND, "Chat not found"),
        Err(err) => crate::async_err::internal_error("get chat", &err),
    }
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
    apply_and_return(&ctx, id, update).await
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
    let update = mainframe_db::chats::ChatUpdate {
        effort: Some(effort),
        ..Default::default()
    };
    apply_and_return(&ctx, id, update).await
}

async fn unarchive(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(chat_id = %id, "unarchive chat is a Phase-4 seam (ChatManager unavailable)");
        return fail(StatusCode::INTERNAL_SERVER_ERROR, "Operation failed");
    };
    match cm.unarchive_chat(&id) {
        Some(chat) => ok(chat),
        None => fail(StatusCode::NOT_FOUND, "Chat not found"),
    }
}

async fn session_files(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    // TODO(port-phase4): ctx.chats.getMessagesFromDisk(id) loads the on-disk JSONL
    // history so subagent file changes absent from the in-memory cache are included;
    // the disk history loader is not yet on the Rust ChatManager facade. Seam.
    let _ = &ctx;
    tracing::warn!(chat_id = %id, "session-files is a Phase-4 seam (ChatManager.getMessagesFromDisk unavailable)");
    fail(StatusCode::INTERNAL_SERVER_ERROR, "Operation failed")
}

fn tool_use_id_ok(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

async fn tool_result(
    State(ctx): State<Arc<AppCtx>>,
    Path((id, tool_use_id)): Path<(String, String)>,
) -> Response {
    if id.is_empty() || !tool_use_id_ok(&tool_use_id) {
        return fail(StatusCode::BAD_REQUEST, "Invalid parameters");
    }
    let lookup_id = id.clone();
    let chat = match ctx.db.call(move |db| db.chats.get(&lookup_id)).await {
        Ok(Some(chat)) => chat,
        Ok(None) => return fail(StatusCode::NOT_FOUND, "Chat not found"),
        Err(err) => return crate::async_err::internal_error("get chat", &err),
    };

    let mut file_path = chat.session_file_path.clone();
    if file_path.is_none()
        && let Some(session_id) = chat.claude_session_id.clone()
    {
        let project_id = chat.project_id.clone();
        let project_path = match ctx.db.call(move |db| db.projects.get(&project_id)).await {
            Ok(project) => project.map(|p| p.path),
            Err(err) => return crate::async_err::internal_error("get project", &err),
        };
        let cwd = chat.worktree_path.clone().or(project_path);
        if let Some(cwd) = cwd {
            let computed = compute_session_file_path(&cwd, &session_id);
            let (cid, fp) = (chat.id.clone(), computed.clone());
            if let Err(err) = ctx
                .db
                .call(move |db| {
                    db.chats.update(
                        &cid,
                        &mainframe_db::chats::ChatUpdate {
                            session_file_path: Some(fp),
                            ..Default::default()
                        },
                    )
                })
                .await
            {
                return crate::async_err::internal_error("persist session file path", &err);
            }
            file_path = Some(computed);
        }
    }

    let Some(file_path) = file_path else {
        return fail(StatusCode::NOT_FOUND, "No session file for chat");
    };
    match mainframe_adapter_claude::messages::read_tool_result_from_jsonl::read_tool_result_from_jsonl(
        &file_path,
        &tool_use_id,
    )
    .await
    {
        Some(content) => ok(serde_json::json!({ "content": content })),
        None => fail(StatusCode::NOT_FOUND, "Tool result not available"),
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/chats", get(list))
        .route("/api/projects/{projectId}/chats", get(list_for_project))
        .route("/api/chats/{id}", get(get_one))
        .route("/api/chats/{id}/archive", post(archive))
        .route("/api/chats/{id}/messages", get(messages))
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
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use mainframe_db::chats::ChatUpdate;
    use mainframe_types::chat::ChatStatus;
    use std::collections::HashMap;

    async fn read(resp: Response) -> (StatusCode, serde_json::Value) {
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let body = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (status, body)
    }

    /// Seeds the chats-filter fixture and returns the label→id map (ids are nanoid,
    /// so the TS `c1..c5` labels are captured, not asserted literally).
    async fn seed(ctx: &Arc<AppCtx>) -> HashMap<&'static str, String> {
        ctx.db
            .call(|db| {
                db.projects.create("/tmp/p", Some("p"))?;
                db.projects.create("/tmp/q", Some("q"))?;
                let p1 = db
                    .projects
                    .list()?
                    .into_iter()
                    .find(|p| p.path == "/tmp/p")
                    .unwrap()
                    .id;
                let p2 = db
                    .projects
                    .list()?
                    .into_iter()
                    .find(|p| p.path == "/tmp/q")
                    .unwrap()
                    .id;

                let mut ids: HashMap<&'static str, String> = HashMap::new();
                let mut mk = |label: &'static str,
                              project: &str,
                              worktree: Option<&str>,
                              archived: bool|
                 -> Result<(), mainframe_db::DbError> {
                    let chat = db.chats.create(project, "claude", None, None)?;
                    let update = ChatUpdate {
                        worktree_path: Some(worktree.map(str::to_string)),
                        status: archived.then_some(ChatStatus::Archived),
                        ..Default::default()
                    };
                    db.chats.update(&chat.id, &update)?;
                    ids.insert(label, chat.id);
                    Ok(())
                };
                mk("c1", &p1, Some("/wt/c1"), false)?;
                mk("c2", &p1, None, false)?;
                mk("c3", &p1, Some("/wt/c3"), false)?;
                mk("c4", &p2, Some("/wt/c4"), false)?;
                mk("c5", &p1, Some("/wt/c5"), true)?;
                db.chat_tags
                    .set_for_chat(&ids["c1"], &["feature".to_string()], &db.tags)?;
                db.chat_tags
                    .set_for_chat(&ids["c2"], &["feature".to_string()], &db.tags)?;
                db.chat_tags
                    .set_for_chat(&ids["c3"], &["bug".to_string()], &db.tags)?;
                Ok(ids)
            })
            .await
            .unwrap()
    }

    fn q(project: Option<&str>, tags: Option<&str>, synthetic: Option<&str>) -> Query<ListQuery> {
        Query(ListQuery {
            project: project.map(str::to_string),
            tags: tags.map(str::to_string),
            synthetic: synthetic.map(str::to_string),
        })
    }

    async fn ids_of(resp: Response) -> Vec<String> {
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::OK);
        let mut ids: Vec<String> = body["data"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["id"].as_str().unwrap().to_string())
            .collect();
        ids.sort();
        ids
    }

    fn labels(ids: &HashMap<&str, String>, keys: &[&str]) -> Vec<String> {
        let mut v: Vec<String> = keys.iter().map(|k| ids[*k].clone()).collect();
        v.sort();
        v
    }

    #[tokio::test]
    async fn no_filters_returns_all_including_archived() {
        let ctx = AppCtx::test_ctx();
        let ids = seed(&ctx).await;
        let got = ids_of(list(State(ctx.clone()), q(None, None, None)).await).await;
        assert_eq!(got, labels(&ids, &["c1", "c2", "c3", "c4", "c5"]));
    }

    #[tokio::test]
    async fn filters_by_project() {
        let ctx = AppCtx::test_ctx();
        let ids = seed(&ctx).await;
        // resolve p2 via c4's project by querying chats
        let p2 = ctx
            .db
            .call(|db| {
                Ok(db
                    .projects
                    .list()?
                    .into_iter()
                    .find(|p| p.path == "/tmp/q")
                    .unwrap()
                    .id)
            })
            .await
            .unwrap();
        let got = ids_of(list(State(ctx.clone()), q(Some(&p2), None, None)).await).await;
        assert_eq!(got, labels(&ids, &["c4"]));
    }

    #[tokio::test]
    async fn filters_by_tags() {
        let ctx = AppCtx::test_ctx();
        let ids = seed(&ctx).await;
        let got = ids_of(list(State(ctx.clone()), q(None, Some("feature"), None)).await).await;
        assert_eq!(got, labels(&ids, &["c1", "c2"]));
    }

    #[tokio::test]
    async fn filters_by_synthetic_has_worktree() {
        let ctx = AppCtx::test_ctx();
        let ids = seed(&ctx).await;
        let got = ids_of(list(State(ctx.clone()), q(None, None, Some("has-worktree"))).await).await;
        assert_eq!(got, labels(&ids, &["c1", "c3", "c4", "c5"]));
    }

    #[tokio::test]
    async fn ignores_has_pr_synthetic() {
        let ctx = AppCtx::test_ctx();
        seed(&ctx).await;
        let got = ids_of(list(State(ctx.clone()), q(None, None, Some("has-pr"))).await).await;
        assert_eq!(got.len(), 5);
    }

    #[tokio::test]
    async fn populates_tags_on_filtered_results() {
        let ctx = AppCtx::test_ctx();
        let ids = seed(&ctx).await;
        let (_, body) = read(list(State(ctx.clone()), q(None, Some("feature"), None)).await).await;
        let c1 = body["data"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == serde_json::json!(ids["c1"]))
            .unwrap();
        assert_eq!(c1["tags"], serde_json::json!(["feature"]));
    }

    #[tokio::test]
    async fn rejects_malformed_tags_400() {
        let ctx = AppCtx::test_ctx();
        let (status, _) =
            read(list(State(ctx.clone()), q(None, Some("feature,BAD!"), None)).await).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn get_missing_chat_404() {
        let ctx = AppCtx::test_ctx();
        let (status, body) = read(get_one(State(ctx.clone()), Path("nope".into())).await).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"], "Chat not found");
    }

    #[tokio::test]
    async fn set_pinned_requires_boolean_400() {
        let ctx = AppCtx::test_ctx();
        let resp = set_pinned(
            State(ctx.clone()),
            Path("c".into()),
            axum::body::Bytes::from("{}"),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "pinned (boolean) is required");
    }

    #[tokio::test]
    async fn set_effort_rejects_bad_level_400() {
        let ctx = AppCtx::test_ctx();
        let resp = set_effort(
            State(ctx.clone()),
            Path("c".into()),
            axum::body::Bytes::from(r#"{"effort":"turbo"}"#),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "effort must be a valid level or null");
    }

    #[tokio::test]
    async fn tool_result_rejects_bad_tool_use_id_400() {
        let ctx = AppCtx::test_ctx();
        let resp = tool_result(State(ctx.clone()), Path(("c".into(), "bad id!".into()))).await;
        let (status, _) = read(resp).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn tool_result_missing_chat_404() {
        let ctx = AppCtx::test_ctx();
        let resp = tool_result(State(ctx.clone()), Path(("nope".into(), "abc".into()))).await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"], "Chat not found");
    }
}

// PORT STATUS: src/server/routes/chats.ts (13 endpoints, 295 lines)
// confidence: medium
// todos: 5
// notes: Reads (list/listFiltered, listChats, getChat) + pinned/tuning/effort PATCH
// + tool-result ported fully over ctx.db.chats (+ compute_session_file_path /
// read_tool_result_from_jsonl helpers). title uses the facade rename when the
// ChatManager is wired, else a db title write (Phase-3 harness). archive /
// getDisplayMessages (messages) / getMessagesFromDisk (session-files) /
// getPendingPermission / unarchive need ChatManager facade methods not yet ported
// (message-cache + disk-history accessors land in the server-integration phase) —
// Phase-4 seams mirroring projects::remove; see blockers. The optional TS
// `syncChatFields?/applyTuning?/emitChatUpdated?` follow-ups on the tuning PATCHes
// are `?.` best-effort in TS and skipped (not on the facade).
