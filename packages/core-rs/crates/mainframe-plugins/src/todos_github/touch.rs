//! Per-field local-recency touch map (todo #286, D3): records only whether
//! `title`/`body`/`state` changed locally, never the row's own `updated_at`.
//! Every other write — labels, priority, milestone, assignees, and moves that
//! don't cross the `done` boundary — is deliberately invisible here, so a
//! reconcile run only sees genuine 3-way-diff candidates.

use std::collections::HashMap;

use serde_json::Value;

use crate::PluginError;
use crate::context::PluginContext;
use crate::db_context::{Row, text};

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
pub async fn stamp_create(ctx: &PluginContext, todo_id: &str, at: &str) -> Result<(), PluginError> {
    for field in TRACKED_FIELDS {
        stamp(ctx, todo_id, field, at).await?;
    }
    Ok(())
}

/// Compares the pre-update row against the incoming patch body. `title`/`body`
/// stamp only on an actual value change (rewriting the held value stamps
/// nothing); `status` stamps `state` only when the write crosses the `done`
/// boundary. Every other field patch_todo accepts is untracked by design.
pub async fn stamp_patch(
    ctx: &PluginContext,
    todo_id: &str,
    existing: &Row,
    body: &Value,
    at: &str,
) -> Result<(), PluginError> {
    for field in ["title", "body"] {
        if let Some(new) = body.get(field).and_then(Value::as_str) {
            let old = existing.get(field).and_then(Value::as_str).unwrap_or("");
            if new != old {
                stamp(ctx, todo_id, field, at).await?;
            }
        }
    }
    if let Some(next) = body.get("status").and_then(Value::as_str) {
        let prev = existing.get("status").and_then(Value::as_str).unwrap_or("");
        if crosses_done_boundary(prev, next) {
            stamp(ctx, todo_id, "state", at).await?;
        }
    }
    Ok(())
}

/// `move_todo`'s status write is projection-aware the same way (D3):
/// open↔in_progress never stamps; crossing the `done` boundary in either
/// direction stamps `state`.
pub async fn stamp_move(
    ctx: &PluginContext,
    todo_id: &str,
    prev_status: &str,
    next_status: &str,
    at: &str,
) -> Result<(), PluginError> {
    if crosses_done_boundary(prev_status, next_status) {
        stamp(ctx, todo_id, "state", at).await?;
    }
    Ok(())
}

fn crosses_done_boundary(prev: &str, next: &str) -> bool {
    (prev == "done") != (next == "done")
}

/// The delete-todo cascade's touch half (AC24) — the pair row itself is
/// `store::delete_pair`'s job, dispatched alongside this from `delete_todo`.
pub async fn clear_for_todo(ctx: &PluginContext, todo_id: &str) -> Result<(), PluginError> {
    ctx.db
        .execute(
            "DELETE FROM github_touch WHERE todo_id = ?".into(),
            vec![text(todo_id.to_string())],
        )
        .await
}

pub async fn read_touch(
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
