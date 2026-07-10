//! Ported from `packages/core/src/plugins/builtin/todos/index.ts` — the builtin
//! TODO Kanban plugin: schema/migrations, the CRUD + move + start-session +
//! attachments HTTP sub-router, and panel/action registration on activate.
//!
//! The Express imperative router (`ctx.router.get(...)`) becomes an axum
//! `Router<Arc<PluginContext>>`; handlers read the capability surfaces off the
//! shared context. `activate` runs migrations, registers the panels/action, and
//! returns the finalized sub-router the manager mounts under `/todos`.

use std::collections::HashMap;
use std::sync::Arc;

use axum::Router;
use axum::extract::{Json, Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use mainframe_runtime::time::now_iso8601;
use mainframe_types::plugin::UiZone;
use serde_json::{Value, json};

use crate::PluginError;
use crate::context::{AttachmentUpload, CreateChatArgs, NotifyOptions, PluginContext};
use crate::db_context::{Row, int, nullable_text, text};

const STATUS: [&str; 3] = ["open", "in_progress", "done"];
const TYPE: [&str; 8] = [
    "bug",
    "feature",
    "enhancement",
    "documentation",
    "question",
    "wont_fix",
    "duplicate",
    "invalid",
];
const PRIORITY: [&str; 4] = ["low", "medium", "high", "critical"];

const MIGRATION: &str = "
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL DEFAULT 0,
  project_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  type TEXT NOT NULL DEFAULT 'feature',
  priority TEXT NOT NULL DEFAULT 'medium',
  labels TEXT NOT NULL DEFAULT '[]',
  assignees TEXT NOT NULL DEFAULT '[]',
  milestone TEXT,
  dependencies TEXT NOT NULL DEFAULT '[]',
  order_index REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);";

// ─── Row parsing ─────────────────────────────────────────────────────────────

/// `parseTodo(row)` — the JSON columns (labels/assignees/dependencies) are
/// parsed into arrays; every other column passes through verbatim, so the
/// response object keeps the raw snake_case column names (`project_id`, …).
fn parse_todo(mut row: Row) -> Value {
    let id = row
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    for col in ["labels", "assignees", "dependencies"] {
        let raw = row
            .get(col)
            .and_then(Value::as_str)
            .unwrap_or("[]")
            .to_string();
        row.insert(
            col.to_string(),
            Value::Array(safe_json_array(&raw, col, &id)),
        );
    }
    Value::Object(row)
}

/// Parse a JSON array column defensively — historical double-encoded values
/// (e.g. `[\"a\"]`) crash `JSON.parse`; a single bad row falls back to `[]`.
fn safe_json_array(raw: &str, column: &str, todo_id: &str) -> Vec<Value> {
    let source = if raw.is_empty() { "[]" } else { raw };
    match serde_json::from_str::<Value>(source) {
        Ok(Value::Array(items)) => items,
        Ok(_) => Vec::new(),
        Err(err) => {
            tracing::warn!(
                todo_id, column, raw, err = %err,
                "todos: malformed JSON column, defaulting to []"
            );
            Vec::new()
        }
    }
}

/// The typed view used by the move/start-session logic and the initial message.
struct TodoView {
    number: i64,
    project_id: String,
    title: String,
    body: String,
    status: String,
    type_field: String,
    priority: String,
    labels: Vec<String>,
    milestone: Option<String>,
    dependencies: Vec<i64>,
}

impl TodoView {
    fn from_row(row: &Row) -> Self {
        let str_col = |k: &str| row.get(k).and_then(Value::as_str).unwrap_or("").to_string();
        let arr = |k: &str| {
            let raw = row.get(k).and_then(Value::as_str).unwrap_or("[]");
            match serde_json::from_str::<Value>(if raw.is_empty() { "[]" } else { raw }) {
                Ok(Value::Array(items)) => items,
                _ => Vec::new(),
            }
        };
        TodoView {
            number: row.get("number").and_then(Value::as_i64).unwrap_or(0),
            project_id: str_col("project_id"),
            title: str_col("title"),
            body: str_col("body"),
            status: str_col("status"),
            type_field: str_col("type"),
            priority: str_col("priority"),
            labels: arr("labels")
                .into_iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect(),
            milestone: row
                .get("milestone")
                .and_then(Value::as_str)
                .map(str::to_string),
            dependencies: arr("dependencies")
                .into_iter()
                .filter_map(|v| v.as_i64())
                .collect(),
        }
    }
}

fn status_label(status: &str) -> String {
    match status {
        "open" => "Open".into(),
        "in_progress" => "In Progress".into(),
        "done" => "Done".into(),
        other => other.to_string(),
    }
}

fn cap(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

/// `buildInitialMessage(todo, depTodos)`.
fn build_initial_message(todo: &TodoView, dep_todos: &[TodoView]) -> String {
    let labels = if todo.labels.is_empty() {
        "none".to_string()
    } else {
        todo.labels.join(", ")
    };
    let mut lines = vec![
        format!("**#{} {}**", todo.number, todo.title),
        format!(
            "Type: {} | Priority: {} | Labels: {}",
            cap(&todo.type_field),
            cap(&todo.priority),
            labels
        ),
    ];
    if let Some(milestone) = &todo.milestone {
        lines.push(format!("Milestone: {milestone}"));
    }
    if !dep_todos.is_empty() {
        let deps = dep_todos
            .iter()
            .map(|d| format!("#{} {} ({})", d.number, d.title, d.status))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("Dependencies: {deps}"));
    }
    if !todo.body.is_empty() {
        lines.push(String::new());
        lines.push("## Description".to_string());
        lines.push(todo.body.clone());
    }
    lines.join("\n")
}

// ─── Response helpers ────────────────────────────────────────────────────────

fn json_response(status: StatusCode, body: Value) -> Response {
    (status, Json(body)).into_response()
}

fn bad_request(error: &str) -> Response {
    json_response(StatusCode::BAD_REQUEST, json!({ "error": error }))
}

fn not_found() -> Response {
    json_response(StatusCode::NOT_FOUND, json!({ "error": "Not found" }))
}

fn server_error(err: PluginError) -> Response {
    tracing::error!(err = %err, "todos: database error");
    json_response(
        StatusCode::INTERNAL_SERVER_ERROR,
        json!({ "error": "Internal error" }),
    )
}

// ─── Schema parsing (Zod equivalents) ────────────────────────────────────────

fn as_non_empty_string(body: &Value, key: &str) -> Option<String> {
    body.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn parse_enum(body: &Value, key: &str, allowed: &[&str], default: &str) -> Option<String> {
    match body.get(key) {
        None | Some(Value::Null) => Some(default.to_string()),
        Some(Value::String(s)) if allowed.contains(&s.as_str()) => Some(s.clone()),
        _ => None,
    }
}

/// Optional enum (update schema): `None` field → Ok(None); present must match.
fn parse_enum_opt(body: &Value, key: &str, allowed: &[&str]) -> Result<Option<String>, ()> {
    match body.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if allowed.contains(&s.as_str()) => Ok(Some(s.clone())),
        _ => Err(()),
    }
}

/// A JSON string-array field with a default of `[]`; present non-arrays fail.
fn parse_string_array(body: &Value, key: &str) -> Option<Vec<String>> {
    match body.get(key) {
        None | Some(Value::Null) => Some(Vec::new()),
        Some(Value::Array(items)) => items
            .iter()
            .map(|v| v.as_str().map(str::to_string))
            .collect(),
        _ => None,
    }
}

/// A JSON number-array field with a default of `[]`; present non-arrays fail.
fn parse_number_array(body: &Value, key: &str) -> Option<Vec<i64>> {
    match body.get(key) {
        None | Some(Value::Null) => Some(Vec::new()),
        Some(Value::Array(items)) => items.iter().map(Value::as_i64).collect(),
        _ => None,
    }
}

struct CreateFields {
    project_id: String,
    title: String,
    body: String,
    status: String,
    type_field: String,
    priority: String,
    labels: Vec<String>,
    assignees: Vec<String>,
    milestone: Option<String>,
    dependencies: Vec<i64>,
}

/// `TodoSchema.safeParse` — returns `None` (→ 400) on any failure.
fn parse_create(body: &Value) -> Option<CreateFields> {
    Some(CreateFields {
        project_id: as_non_empty_string(body, "projectId")?,
        title: as_non_empty_string(body, "title")?,
        body: body
            .get("body")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        status: parse_enum(body, "status", &STATUS, "open")?,
        type_field: parse_enum(body, "type", &TYPE, "feature")?,
        priority: parse_enum(body, "priority", &PRIORITY, "medium")?,
        labels: parse_string_array(body, "labels")?,
        assignees: parse_string_array(body, "assignees")?,
        milestone: body
            .get("milestone")
            .and_then(Value::as_str)
            .map(str::to_string),
        dependencies: parse_number_array(body, "dependencies")?,
    })
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async fn get_todos(
    State(ctx): State<Arc<PluginContext>>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let Some(project_id) = params.get("projectId") else {
        return bad_request("projectId required");
    };
    match ctx
        .db
        .query_all(
            "SELECT * FROM todos WHERE project_id = ? ORDER BY status, order_index, created_at"
                .into(),
            vec![text(project_id.clone())],
        )
        .await
    {
        Ok(rows) => json_response(
            StatusCode::OK,
            json!({ "todos": rows.into_iter().map(parse_todo).collect::<Vec<_>>() }),
        ),
        Err(err) => server_error(err),
    }
}

async fn post_todo(State(ctx): State<Arc<PluginContext>>, Json(body): Json<Value>) -> Response {
    let Some(d) = parse_create(&body) else {
        return bad_request("Invalid input");
    };
    let now = now_iso8601();
    let id = nanoid::nanoid!();
    let insert = "INSERT INTO todos (id,number,project_id,title,body,status,type,priority,labels,assignees,milestone,dependencies,order_index,created_at,updated_at) \
         VALUES (?, \
           (SELECT COALESCE(MAX(number), 0) + 1 FROM todos WHERE project_id = ?), \
           ?,?,?,?,?,?,?,?,?,?,?,?,?)";
    let params = vec![
        text(id.clone()),
        text(d.project_id.clone()),
        text(d.project_id),
        text(d.title),
        text(d.body),
        text(d.status),
        text(d.type_field),
        text(d.priority),
        text(to_json_string(&d.labels)),
        text(to_json_string(&d.assignees)),
        nullable_text(d.milestone),
        text(to_json_string(&d.dependencies)),
        int(0),
        text(now.clone()),
        text(now),
    ];
    if let Err(err) = ctx.db.execute(insert.into(), params).await {
        return server_error(err);
    }
    match fetch_row(&ctx, &id).await {
        Ok(Some(row)) => json_response(StatusCode::CREATED, json!({ "todo": parse_todo(row) })),
        Ok(None) => server_error(PluginError::Message("inserted row not found".into())),
        Err(err) => server_error(err),
    }
}

async fn patch_todo(
    State(ctx): State<Arc<PluginContext>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let existing = match fetch_row(&ctx, &id).await {
        Ok(Some(row)) => row,
        Ok(None) => return not_found(),
        Err(err) => return server_error(err),
    };
    let existing_status = existing
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let mut sets = vec!["updated_at = ?".to_string()];
    let mut vals = vec![text(now_iso8601())];

    macro_rules! set_text {
        ($key:literal, $col:literal) => {
            if let Some(v) = body.get($key).filter(|v| !v.is_null()) {
                let Some(s) = v.as_str() else {
                    return bad_request("Invalid input");
                };
                if $key == "title" && s.is_empty() {
                    return bad_request("Invalid input");
                }
                sets.push(concat!($col, " = ?").to_string());
                vals.push(text(s.to_string()));
            }
        };
    }

    set_text!("title", "title");
    set_text!("body", "body");

    match parse_enum_opt(&body, "status", &STATUS) {
        Ok(Some(s)) => {
            sets.push("status = ?".to_string());
            vals.push(text(s));
        }
        Ok(None) => {}
        Err(()) => return bad_request("Invalid input"),
    }
    match parse_enum_opt(&body, "type", &TYPE) {
        Ok(Some(s)) => {
            sets.push("type = ?".to_string());
            vals.push(text(s));
        }
        Ok(None) => {}
        Err(()) => return bad_request("Invalid input"),
    }
    match parse_enum_opt(&body, "priority", &PRIORITY) {
        Ok(Some(s)) => {
            sets.push("priority = ?".to_string());
            vals.push(text(s));
        }
        Ok(None) => {}
        Err(()) => return bad_request("Invalid input"),
    }

    if body.get("labels").is_some_and(|v| !v.is_null()) {
        let Some(labels) = parse_string_array(&body, "labels") else {
            return bad_request("Invalid input");
        };
        sets.push("labels = ?".to_string());
        vals.push(text(to_json_string(&labels)));
    }
    if body.get("assignees").is_some_and(|v| !v.is_null()) {
        let Some(assignees) = parse_string_array(&body, "assignees") else {
            return bad_request("Invalid input");
        };
        sets.push("assignees = ?".to_string());
        vals.push(text(to_json_string(&assignees)));
    }
    if let Some(milestone) = body.get("milestone")
        && !milestone.is_null()
    {
        let Some(s) = milestone.as_str() else {
            return bad_request("Invalid input");
        };
        sets.push("milestone = ?".to_string());
        vals.push(text(s.to_string()));
    }
    if body.get("dependencies").is_some_and(|v| !v.is_null()) {
        let Some(deps) = parse_number_array(&body, "dependencies") else {
            return bad_request("Invalid input");
        };
        sets.push("dependencies = ?".to_string());
        vals.push(text(to_json_string(&deps)));
    }

    vals.push(text(id.clone()));
    let sql = format!("UPDATE todos SET {} WHERE id = ?", sets.join(", "));
    if let Err(err) = ctx.db.execute(sql, vals).await {
        return server_error(err);
    }

    let row = match fetch_row(&ctx, &id).await {
        Ok(Some(row)) => row,
        Ok(None) => return not_found(),
        Err(err) => return server_error(err),
    };
    let updated = TodoView::from_row(&row);
    if let Some(new_status) = parse_enum_opt(&body, "status", &STATUS).ok().flatten()
        && new_status != existing_status
    {
        ctx.ui.notify(NotifyOptions {
            title: format!("#{} {}", updated.number, updated.title),
            body: format!("Moved to {}", status_label(&new_status)),
            level: Some("success".to_string()),
        });
    }
    json_response(StatusCode::OK, json!({ "todo": parse_todo(row) }))
}

async fn move_todo(
    State(ctx): State<Arc<PluginContext>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let Some(status) = parse_status_only(&body) else {
        return bad_request("Invalid status");
    };
    if let Err(err) = ctx
        .db
        .execute(
            "UPDATE todos SET status = ?, updated_at = ? WHERE id = ?".into(),
            vec![text(status.clone()), text(now_iso8601()), text(id.clone())],
        )
        .await
    {
        return server_error(err);
    }
    let row = match fetch_row(&ctx, &id).await {
        Ok(Some(row)) => row,
        Ok(None) => return not_found(),
        Err(err) => return server_error(err),
    };
    let todo = TodoView::from_row(&row);
    if status == "done" && !todo.dependencies.is_empty() {
        let open_deps = match load_dependencies(&ctx, &todo).await {
            Ok(deps) => deps
                .into_iter()
                .filter(|d| d.status != "done")
                .collect::<Vec<_>>(),
            Err(err) => return server_error(err),
        };
        if !open_deps.is_empty() {
            let names = open_deps
                .iter()
                .map(|d| format!("#{} {}", d.number, d.title))
                .collect::<Vec<_>>()
                .join(", ");
            ctx.ui.notify(NotifyOptions {
                title: format!("#{} {} has open dependencies", todo.number, todo.title),
                body: names,
                level: Some("warning".to_string()),
            });
        }
    }
    json_response(StatusCode::OK, json!({ "todo": parse_todo(row) }))
}

fn parse_status_only(body: &Value) -> Option<String> {
    match body.get("status") {
        Some(Value::String(s)) if STATUS.contains(&s.as_str()) => Some(s.clone()),
        _ => None,
    }
}

async fn delete_todo(State(ctx): State<Arc<PluginContext>>, Path(id): Path<String>) -> Response {
    match ctx
        .db
        .execute("DELETE FROM todos WHERE id = ?".into(), vec![text(id)])
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => server_error(err),
    }
}

async fn start_session(
    State(ctx): State<Arc<PluginContext>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let row = match fetch_row(&ctx, &id).await {
        Ok(Some(row)) => row,
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
    let todo = TodoView::from_row(&row);
    let dep_todos = match load_dependencies(&ctx, &todo).await {
        Ok(deps) => deps,
        Err(err) => return server_error(err),
    };
    match ctx
        .chats
        .create_chat(CreateChatArgs {
            project_id: project_id.to_string(),
            ..Default::default()
        })
        .await
    {
        Ok(result) => json_response(
            StatusCode::OK,
            json!({
                "chatId": result.chat_id,
                "initialMessage": build_initial_message(&todo, &dep_todos),
            }),
        ),
        Err(err) => server_error(err),
    }
}

async fn list_attachments(
    State(ctx): State<Arc<PluginContext>>,
    Path(id): Path<String>,
) -> Response {
    match ctx.attachments.list(&id).await {
        Ok(metas) => json_response(StatusCode::OK, json!({ "attachments": metas })),
        Err(err) => server_error(err),
    }
}

async fn post_attachment(
    State(ctx): State<Arc<PluginContext>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    match fetch_id(&ctx, &id).await {
        Ok(true) => {}
        Ok(false) => return not_found(),
        Err(err) => return server_error(err),
    }
    let Some(filename) = as_non_empty_string(&body, "filename") else {
        return bad_request("Invalid input");
    };
    let Some(data) = body.get("data").and_then(Value::as_str) else {
        return bad_request("Invalid input");
    };
    let size_bytes = match body.get("sizeBytes") {
        None | Some(Value::Null) => 0,
        Some(v) => match v.as_i64().filter(|n| *n >= 0) {
            Some(n) => n,
            None => return bad_request("Invalid input"),
        },
    };
    let mime_type = body
        .get("mimeType")
        .and_then(Value::as_str)
        .unwrap_or("application/octet-stream")
        .to_string();
    match ctx
        .attachments
        .save(
            &id,
            AttachmentUpload {
                filename,
                mime_type,
                data: data.to_string(),
                size_bytes,
            },
        )
        .await
    {
        Ok(meta) => json_response(StatusCode::CREATED, json!({ "attachment": meta })),
        Err(err) => server_error(err),
    }
}

async fn get_attachment(
    State(ctx): State<Arc<PluginContext>>,
    Path((id, attachment_id)): Path<(String, String)>,
) -> Response {
    match ctx.attachments.get(&id, &attachment_id).await {
        Ok(Some(result)) => json_response(
            StatusCode::OK,
            serde_json::to_value(result).unwrap_or(Value::Null),
        ),
        Ok(None) => not_found(),
        Err(err) => server_error(err),
    }
}

async fn delete_attachment(
    State(ctx): State<Arc<PluginContext>>,
    Path((id, attachment_id)): Path<(String, String)>,
) -> Response {
    match ctx.attachments.delete(&id, &attachment_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => server_error(err),
    }
}

// ─── Shared query helpers ────────────────────────────────────────────────────

async fn fetch_row(ctx: &PluginContext, id: &str) -> Result<Option<Row>, PluginError> {
    ctx.db
        .query_one(
            "SELECT * FROM todos WHERE id = ?".into(),
            vec![text(id.to_string())],
        )
        .await
}

async fn fetch_id(ctx: &PluginContext, id: &str) -> Result<bool, PluginError> {
    Ok(ctx
        .db
        .query_one(
            "SELECT id FROM todos WHERE id = ?".into(),
            vec![text(id.to_string())],
        )
        .await?
        .is_some())
}

/// Resolve a todo's dependency numbers to `TodoView`s (skipping missing ones).
async fn load_dependencies(
    ctx: &PluginContext,
    todo: &TodoView,
) -> Result<Vec<TodoView>, PluginError> {
    let mut out = Vec::new();
    for num in &todo.dependencies {
        let row = ctx
            .db
            .query_one(
                "SELECT * FROM todos WHERE number = ? AND project_id = ?".into(),
                vec![int(*num), text(todo.project_id.clone())],
            )
            .await?;
        if let Some(row) = row {
            out.push(TodoView::from_row(&row));
        }
    }
    Ok(out)
}

fn to_json_string<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "[]".to_string())
}

// ─── Activation ──────────────────────────────────────────────────────────────

/// The plugin's HTTP sub-router (relative to its `/todos` mount point).
pub fn routes() -> Router<Arc<PluginContext>> {
    Router::new()
        .route("/todos", get(get_todos).post(post_todo))
        .route("/todos/{id}", patch(patch_todo).delete(delete_todo))
        .route("/todos/{id}/move", patch(move_todo))
        .route("/todos/{id}/start-session", post(start_session))
        .route(
            "/todos/{id}/attachments",
            get(list_attachments).post(post_attachment),
        )
        .route(
            "/todos/{id}/attachments/{attachmentId}",
            get(get_attachment).delete(delete_attachment),
        )
}

async fn run_migrations(ctx: &PluginContext) -> Result<(), PluginError> {
    ctx.db.run_migration(MIGRATION.into()).await?;
    let cols = ctx
        .db
        .query_all("PRAGMA table_info(todos)".into(), vec![])
        .await?;
    let col_names: Vec<String> = cols
        .iter()
        .filter_map(|c| c.get("name").and_then(Value::as_str).map(str::to_string))
        .collect();
    if !col_names.iter().any(|c| c == "number") {
        ctx.db
            .run_migration("ALTER TABLE todos ADD COLUMN number INTEGER NOT NULL DEFAULT 0".into())
            .await?;
        let rows = ctx
            .db
            .query_all("SELECT id FROM todos ORDER BY created_at".into(), vec![])
            .await?;
        for (i, row) in rows.iter().enumerate() {
            let id = row
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            ctx.db
                .execute(
                    "UPDATE todos SET number = ? WHERE id = ?".into(),
                    vec![int((i as i64) + 1), text(id)],
                )
                .await?;
        }
    }
    if !col_names.iter().any(|c| c == "project_id") {
        ctx.db
            .run_migration(
                "ALTER TABLE todos ADD COLUMN project_id TEXT NOT NULL DEFAULT ''".into(),
            )
            .await?;
    }
    if !col_names.iter().any(|c| c == "dependencies") {
        ctx.db
            .run_migration(
                "ALTER TABLE todos ADD COLUMN dependencies TEXT NOT NULL DEFAULT '[]'".into(),
            )
            .await?;
    }
    Ok(())
}

/// `activate(ctx)` — run migrations, register the panels/action, and return the
/// finalized sub-router (the manager mounts it under `/<plugin id>`).
pub async fn activate(ctx: Arc<PluginContext>) -> Result<Router<()>, PluginError> {
    run_migrations(&ctx).await?;

    // Primary fullview: Kanban board.
    let kanban = ctx
        .ui
        .add_panel(UiZone::Fullview, "Tasks", Some("square-check"));
    // Secondary right-top zone: quick-add summary sidebar.
    let sidebar = ctx
        .ui
        .add_panel(UiZone::RightTop, "Tasks Sidebar", Some("list-todo"));
    ctx.ui
        .add_action("quick-create", "New Task", "mod+t", Some("plus"));

    let ui = Arc::clone(&ctx.ui);
    ctx.on_unload(move || {
        ui.remove_panel(Some(&kanban));
        ui.remove_panel(Some(&sidebar));
        ui.remove_action("quick-create");
    });
    tracing::info!("TODO Kanban plugin activated");

    Ok(routes().with_state(ctx))
}

// PORT STATUS: src/plugins/builtin/todos/index.ts
// confidence: high
// todos: 0
// notes: Express router → axum Router<Arc<PluginContext>>. parseTodo keeps raw
// snake_case columns, replacing the three JSON array columns (safeJsonArray
// tolerates historical double-encoded values). Zod schemas hand-rolled: create
// requires projectId+title, defaults body/status/type/priority/labels/assignees/
// dependencies, validates enums; update is all-optional with the same enum/array
// guards; the move body accepts only the status enum; the attachment upload
// requires filename+data (empty data allowed) and a non-negative sizeBytes. The
// per-project `number` uses the same MAX(number)+1 subquery. start-session gates
// on chat:create (403), builds the initial message, and returns { chatId,
// initialMessage }. Migrations mirror the additive ALTER-COLUMN backfill.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::{PluginContextDeps, PluginHostDb, build_plugin_context};
    use crate::event_bus::PublicDaemonBus;
    use axum::body::to_bytes;
    use mainframe_types::chat::Chat;
    use mainframe_types::events::DaemonEvent;
    use mainframe_types::plugin::{PluginCapability, PluginManifest};
    use std::sync::Mutex;

    /// A recorded `chats_create` call: (projectId, adapterId, model, mode).
    type CreatedChat = (String, String, Option<String>, Option<String>);

    #[derive(Default)]
    struct FakeHostDb {
        created: Mutex<Vec<CreatedChat>>,
        settings: Mutex<HashMap<(String, String), String>>,
    }

    fn make_chat(id: &str, project_id: &str) -> Chat {
        let now = now_iso8601();
        serde_json::from_value(json!({
            "id": id,
            "adapterId": "claude",
            "projectId": project_id,
            "status": "active",
            "createdAt": now,
            "updatedAt": now,
            "totalCost": 0.0,
            "totalTokensInput": 0,
            "totalTokensOutput": 0,
            "lastContextTokensInput": 0,
        }))
        .unwrap()
    }

    impl PluginHostDb for FakeHostDb {
        fn chats_list(&self, _project_id: &str) -> Vec<Chat> {
            Vec::new()
        }
        fn chats_get(&self, _id: &str) -> Option<Chat> {
            None
        }
        fn chats_create(
            &self,
            project_id: &str,
            adapter_id: &str,
            model: Option<&str>,
            permission_mode: Option<&str>,
        ) -> Chat {
            self.created.lock().unwrap().push((
                project_id.to_string(),
                adapter_id.to_string(),
                model.map(str::to_string),
                permission_mode.map(str::to_string),
            ));
            make_chat("chat-1", project_id)
        }
        fn settings_get(&self, category: &str, key: &str) -> Option<String> {
            self.settings
                .lock()
                .unwrap()
                .get(&(category.to_string(), key.to_string()))
                .cloned()
        }
        fn settings_set(&self, _category: &str, _key: &str, _value: &str) {}
        fn projects_list(&self) -> Vec<mainframe_types::chat::Project> {
            Vec::new()
        }
        fn projects_get(&self, _id: &str) -> Option<mainframe_types::chat::Project> {
            None
        }
    }

    struct Harness {
        _dir: tempfile::TempDir,
        ctx: Arc<PluginContext>,
        host: Arc<FakeHostDb>,
        events: Arc<Mutex<Vec<DaemonEvent>>>,
    }

    async fn setup() -> Harness {
        setup_with_settings(&[]).await
    }

    async fn setup_with_settings(settings: &[((&str, &str), &str)]) -> Harness {
        let dir = tempfile::tempdir().unwrap();
        let host = Arc::new(FakeHostDb::default());
        for ((cat, key), value) in settings {
            host.settings
                .lock()
                .unwrap()
                .insert((cat.to_string(), key.to_string()), value.to_string());
        }
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        let emit: crate::context::EmitSink = Arc::new(move |e| sink.lock().unwrap().push(e));
        let manifest = PluginManifest {
            id: "todos".into(),
            name: "TODO Kanban".into(),
            version: "1.0.0".into(),
            description: None,
            author: None,
            license: None,
            capabilities: vec![
                PluginCapability::Storage,
                PluginCapability::ChatCreate,
                PluginCapability::UiPanels,
            ],
            ui: None,
            adapter: None,
            commands: None,
        };
        let ctx = build_plugin_context(PluginContextDeps {
            manifest,
            plugin_dir: dir.path().to_path_buf(),
            host_db: Arc::clone(&host) as Arc<dyn PluginHostDb>,
            daemon_bus: Arc::new(PublicDaemonBus::new()),
            emit,
            adapters: None,
        })
        .unwrap();
        run_migrations(&ctx).await.unwrap();
        Harness {
            _dir: dir,
            ctx,
            host,
            events,
        }
    }

    async fn read(resp: Response) -> (StatusCode, Value) {
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    fn state(h: &Harness) -> State<Arc<PluginContext>> {
        State(Arc::clone(&h.ctx))
    }

    async fn create_todo(h: &Harness, body: Value) -> Value {
        let (status, out) = read(post_todo(state(h), Json(body)).await).await;
        assert_eq!(status, StatusCode::CREATED);
        out["todo"].clone()
    }

    fn notifications(h: &Harness) -> Vec<Value> {
        h.events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                DaemonEvent::PluginNotification {
                    title, body, level, ..
                } => Some(json!({ "title": title, "body": body, "level": level })),
                _ => None,
            })
            .collect()
    }

    #[tokio::test]
    async fn get_returns_400_when_project_id_missing() {
        let h = setup().await;
        let (status, body) = read(get_todos(state(&h), Query(HashMap::new())).await).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, json!({ "error": "projectId required" }));
    }

    #[tokio::test]
    async fn get_returns_empty_for_project_with_no_todos() {
        let h = setup().await;
        let q = Query(HashMap::from([("projectId".to_string(), "p1".to_string())]));
        let (status, body) = read(get_todos(state(&h), q).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, json!({ "todos": [] }));
    }

    #[tokio::test]
    async fn create_assigns_defaults_and_number_one() {
        let h = setup().await;
        let todo = create_todo(&h, json!({ "projectId": "p1", "title": "First task" })).await;
        assert_eq!(todo["number"], json!(1));
        assert_eq!(todo["project_id"], json!("p1"));
        assert_eq!(todo["title"], json!("First task"));
        assert_eq!(todo["body"], json!(""));
        assert_eq!(todo["status"], json!("open"));
        assert_eq!(todo["type"], json!("feature"));
        assert_eq!(todo["priority"], json!("medium"));
        assert_eq!(todo["labels"], json!([]));
        assert_eq!(todo["assignees"], json!([]));
        assert_eq!(todo["dependencies"], json!([]));
        assert!(todo["id"].is_string());
    }

    #[tokio::test]
    async fn create_bug_type_persists() {
        let h = setup().await;
        let todo = create_todo(
            &h,
            json!({ "projectId": "proj-1", "title": "Fix login bug", "type": "bug" }),
        )
        .await;
        assert_eq!(todo["type"], json!("bug"));
        assert_eq!(todo["status"], json!("open"));
    }

    #[tokio::test]
    async fn create_increments_per_project_number() {
        let h = setup().await;
        create_todo(&h, json!({ "projectId": "p1", "title": "First" })).await;
        let second = create_todo(&h, json!({ "projectId": "p1", "title": "Second" })).await;
        assert_eq!(second["number"], json!(2));
    }

    #[tokio::test]
    async fn create_400_when_title_missing() {
        let h = setup().await;
        let (status, body) =
            read(post_todo(state(&h), Json(json!({ "projectId": "p1" }))).await).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, json!({ "error": "Invalid input" }));
    }

    #[tokio::test]
    async fn create_400_for_invalid_status_enum() {
        let h = setup().await;
        let resp = post_todo(
            state(&h),
            Json(json!({ "projectId": "p1", "title": "x", "status": "bogus" })),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, json!({ "error": "Invalid input" }));
    }

    #[tokio::test]
    async fn patch_404_for_missing() {
        let h = setup().await;
        let resp = patch_todo(
            state(&h),
            Path("missing".to_string()),
            Json(json!({ "title": "x" })),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body, json!({ "error": "Not found" }));
    }

    #[tokio::test]
    async fn patch_title_without_notifying() {
        let h = setup().await;
        let id = create_todo(&h, json!({ "projectId": "p1", "title": "T" })).await["id"]
            .as_str()
            .unwrap()
            .to_string();
        let resp = patch_todo(state(&h), Path(id), Json(json!({ "title": "Renamed" }))).await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["todo"]["title"], json!("Renamed"));
        assert!(notifications(&h).is_empty());
    }

    #[tokio::test]
    async fn patch_notifies_on_status_change() {
        let h = setup().await;
        let id = create_todo(&h, json!({ "projectId": "p1", "title": "T" })).await["id"]
            .as_str()
            .unwrap()
            .to_string();
        let resp = patch_todo(
            state(&h),
            Path(id),
            Json(json!({ "status": "in_progress" })),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["todo"]["status"], json!("in_progress"));
        assert_eq!(
            notifications(&h),
            vec![json!({ "title": "#1 T", "body": "Moved to In Progress", "level": "success" })]
        );
    }

    #[tokio::test]
    async fn move_400_for_invalid_status() {
        let h = setup().await;
        let resp = move_todo(
            state(&h),
            Path("x".to_string()),
            Json(json!({ "status": "bogus" })),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, json!({ "error": "Invalid status" }));
    }

    #[tokio::test]
    async fn move_404_when_absent() {
        let h = setup().await;
        let resp = move_todo(
            state(&h),
            Path("missing".to_string()),
            Json(json!({ "status": "done" })),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body, json!({ "error": "Not found" }));
    }

    #[tokio::test]
    async fn move_changes_status() {
        let h = setup().await;
        let id = create_todo(&h, json!({ "projectId": "proj-1", "title": "Test" })).await["id"]
            .as_str()
            .unwrap()
            .to_string();
        let resp = move_todo(
            state(&h),
            Path(id),
            Json(json!({ "status": "in_progress" })),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["todo"]["status"], json!("in_progress"));
    }

    #[tokio::test]
    async fn move_warns_on_open_dependencies() {
        let h = setup().await;
        let dep = create_todo(&h, json!({ "projectId": "p1", "title": "Dep" })).await;
        let dep_num = dep["number"].as_i64().unwrap();
        let main = create_todo(
            &h,
            json!({ "projectId": "p1", "title": "Main", "dependencies": [dep_num] }),
        )
        .await;
        let main_id = main["id"].as_str().unwrap().to_string();
        let resp = move_todo(state(&h), Path(main_id), Json(json!({ "status": "done" }))).await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["todo"]["status"], json!("done"));
        assert_eq!(
            notifications(&h),
            vec![json!({
                "title": "#2 Main has open dependencies",
                "body": "#1 Dep",
                "level": "warning",
            })]
        );
    }

    #[tokio::test]
    async fn delete_returns_204_and_removes() {
        let h = setup().await;
        let id = create_todo(&h, json!({ "projectId": "p1", "title": "T" })).await["id"]
            .as_str()
            .unwrap()
            .to_string();
        let resp = delete_todo(state(&h), Path(id)).await;
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
        let q = Query(HashMap::from([("projectId".to_string(), "p1".to_string())]));
        let (_, body) = read(get_todos(state(&h), q).await).await;
        assert_eq!(body["todos"], json!([]));
    }

    #[tokio::test]
    async fn get_tolerates_malformed_json_columns() {
        let h = setup().await;
        create_todo(
            &h,
            json!({ "projectId": "proj-1", "title": "Good todo", "labels": ["ok"] }),
        )
        .await;
        let bad = create_todo(
            &h,
            json!({ "projectId": "proj-1", "title": "Corrupt todo" }),
        )
        .await;
        let bad_id = bad["id"].as_str().unwrap().to_string();
        // Simulate the historical double-encoded value seen in production data.
        h.ctx
            .db
            .execute(
                "UPDATE todos SET labels = ? WHERE id = ?".into(),
                vec![
                    text(r#"[\"workflows\",\"design\"]"#.to_string()),
                    text(bad_id.clone()),
                ],
            )
            .await
            .unwrap();
        let q = Query(HashMap::from([(
            "projectId".to_string(),
            "proj-1".to_string(),
        )]));
        let (status, body) = read(get_todos(state(&h), q).await).await;
        assert_eq!(status, StatusCode::OK);
        let todos = body["todos"].as_array().unwrap();
        assert_eq!(todos.len(), 2);
        let corrupt = todos.iter().find(|t| t["id"] == json!(bad_id)).unwrap();
        assert_eq!(corrupt["labels"], json!([]));
        let good = todos
            .iter()
            .find(|t| t["title"] == json!("Good todo"))
            .unwrap();
        assert_eq!(good["labels"], json!(["ok"]));
    }

    #[tokio::test]
    async fn start_session_404_for_missing() {
        let h = setup().await;
        let resp = start_session(
            state(&h),
            Path("missing".to_string()),
            Json(json!({ "projectId": "p1" })),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body, json!({ "error": "Not found" }));
    }

    #[tokio::test]
    async fn start_session_400_when_project_id_missing() {
        let h = setup().await;
        let id = create_todo(&h, json!({ "projectId": "p1", "title": "T" })).await["id"]
            .as_str()
            .unwrap()
            .to_string();
        let resp = start_session(state(&h), Path(id), Json(json!({}))).await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, json!({ "error": "projectId required" }));
    }

    #[tokio::test]
    async fn start_session_creates_chat_and_message() {
        let h = setup().await;
        let id = create_todo(
            &h,
            json!({ "projectId": "p1", "title": "Ship it", "body": "Do the thing", "labels": ["urgent"] }),
        )
        .await["id"]
            .as_str()
            .unwrap()
            .to_string();
        let resp = start_session(state(&h), Path(id), Json(json!({ "projectId": "p1" }))).await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["chatId"], json!("chat-1"));
        assert_eq!(
            body["initialMessage"],
            json!(
                "**#1 Ship it**\nType: Feature | Priority: Medium | Labels: urgent\n\n## Description\nDo the thing"
            )
        );
        assert_eq!(
            h.host.created.lock().unwrap().as_slice(),
            [("p1".to_string(), "claude".to_string(), None, None)]
        );
        // chat.created emitted by the chat service.
        assert!(
            h.events
                .lock()
                .unwrap()
                .iter()
                .any(|e| matches!(e, DaemonEvent::ChatCreated { .. }))
        );
    }

    #[tokio::test]
    async fn start_session_reads_provider_defaults() {
        let h = setup_with_settings(&[
            (("provider", "claude.defaultModel"), "opus"),
            (("provider", "claude.defaultMode"), "plan"),
        ])
        .await;
        let id = create_todo(&h, json!({ "projectId": "p1", "title": "Big feature" })).await["id"]
            .as_str()
            .unwrap()
            .to_string();
        let resp = start_session(state(&h), Path(id), Json(json!({ "projectId": "p1" }))).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            h.host.created.lock().unwrap().as_slice(),
            [(
                "p1".to_string(),
                "claude".to_string(),
                Some("opus".to_string()),
                Some("plan".to_string())
            )]
        );
    }

    #[tokio::test]
    async fn attachment_400_when_filename_missing() {
        let h = setup().await;
        let id = create_todo(&h, json!({ "projectId": "p1", "title": "A" })).await["id"]
            .as_str()
            .unwrap()
            .to_string();
        let resp =
            post_attachment(state(&h), Path(id), Json(json!({ "data": "base64data" }))).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn attachment_400_when_data_missing() {
        let h = setup().await;
        let id = create_todo(&h, json!({ "projectId": "p1", "title": "A" })).await["id"]
            .as_str()
            .unwrap()
            .to_string();
        let resp =
            post_attachment(state(&h), Path(id), Json(json!({ "filename": "file.txt" }))).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn attachment_accepts_zero_byte_file() {
        let h = setup().await;
        let id = create_todo(&h, json!({ "projectId": "p1", "title": "A" })).await["id"]
            .as_str()
            .unwrap()
            .to_string();
        let resp = post_attachment(
            state(&h),
            Path(id),
            Json(json!({ "filename": "empty.txt", "data": "", "sizeBytes": 0 })),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(body["attachment"]["filename"], json!("empty.txt"));
    }
}
