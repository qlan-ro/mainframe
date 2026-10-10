//! Per-field local-recency touch map: records only whether
//! `title`/`body`/`state` changed locally, never the row's own `updated_at`.
//! Every other write — labels, priority, milestone, assignees, and moves that
//! don't cross the `done` boundary — is deliberately invisible here, so a
//! reconcile run only sees genuine 3-way-diff candidates.

use std::collections::HashMap;

use crate::PluginError;
use crate::context::PluginContext;
use crate::db_context::text;
use crate::todos::input::PatchTodo;
use crate::todos::types::{Todo, TodoStatus};

const TRACKED_FIELDS: [&str; 3] = ["title", "body", "state"];

async fn stamp(
    ctx: &PluginContext,
    todo_id: &str,
    field: &str,
    at: &str,
) -> Result<(), PluginError> {
    ctx.db
        .execute(
            "INSERT INTO github_touch (todo_id, field, changed_at) VALUES (?, ?, ?)
             ON CONFLICT(todo_id, field) DO UPDATE SET changed_at = excluded.changed_at"
                .into(),
            vec![
                text(todo_id.to_string()),
                text(field.to_string()),
                text(at.to_string()),
            ],
        )
        .await
}

/// A freshly created todo starts fully "locally recent" — every tracked field
/// stamps at creation time.
pub(crate) async fn stamp_create(
    ctx: &PluginContext,
    todo_id: &str,
    at: &str,
) -> Result<(), PluginError> {
    for field in TRACKED_FIELDS {
        stamp(ctx, todo_id, field, at).await?;
    }
    Ok(())
}

/// Compares the pre-update row against the incoming patch. `title`/`body`
/// stamp only on an actual value change (rewriting the held value stamps
/// nothing); `status` stamps `state` only when the write crosses the `done`
/// boundary. Every other field patch_todo accepts is untracked by design.
pub(crate) async fn stamp_patch(
    ctx: &PluginContext,
    todo_id: &str,
    existing: &Todo,
    patch: &PatchTodo,
    at: &str,
) -> Result<(), PluginError> {
    if patch
        .title
        .as_deref()
        .is_some_and(|title| title != existing.title)
    {
        stamp(ctx, todo_id, "title", at).await?;
    }
    if patch
        .body
        .as_deref()
        .is_some_and(|body| body != existing.body)
    {
        stamp(ctx, todo_id, "body", at).await?;
    }
    if let Some(next) = patch.status
        && crosses_done_boundary(existing.status, next)
    {
        stamp(ctx, todo_id, "state", at).await?;
    }
    Ok(())
}

/// `move_todo`'s status write is projection-aware the same way:
/// open↔in_progress never stamps; crossing the `done` boundary in either
/// direction stamps `state`.
pub(crate) async fn stamp_move(
    ctx: &PluginContext,
    todo_id: &str,
    prev_status: TodoStatus,
    next_status: TodoStatus,
    at: &str,
) -> Result<(), PluginError> {
    if crosses_done_boundary(prev_status, next_status) {
        stamp(ctx, todo_id, "state", at).await?;
    }
    Ok(())
}

fn crosses_done_boundary(prev: TodoStatus, next: TodoStatus) -> bool {
    (prev == TodoStatus::Done) != (next == TodoStatus::Done)
}

/// The delete-todo cascade's touch half (AC24) — the pair row itself is
/// `store::delete_pair`'s job, dispatched alongside this from `delete_todo`.
pub(crate) async fn clear_for_todo(ctx: &PluginContext, todo_id: &str) -> Result<(), PluginError> {
    ctx.db
        .execute(
            "DELETE FROM github_touch WHERE todo_id = ?".into(),
            vec![text(todo_id.to_string())],
        )
        .await
}

pub(crate) async fn read_touch(
    ctx: &PluginContext,
    todo_id: &str,
) -> Result<HashMap<String, String>, PluginError> {
    let rows = ctx
        .db
        .query_all(
            "SELECT field, changed_at FROM github_touch WHERE todo_id = ?".into(),
            vec![text(todo_id.to_string())],
        )
        .await?;
    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let field = row.get("field")?.as_str()?.to_string();
            let at = row.get("changed_at")?.as_str()?.to_string();
            Some((field, at))
        })
        .collect())
}
