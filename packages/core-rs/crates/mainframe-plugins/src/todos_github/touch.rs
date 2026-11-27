//! Per-field local-recency touch map: records only whether
//! `title`/`body`/`state` changed locally, never the row's own `updated_at`.
//! Every other write — labels, priority, milestone, assignees, and moves that
//! don't cross the `done` boundary — is deliberately invisible here, so a
//! reconcile run only sees genuine 3-way-diff candidates.
//!
//! The helpers take a connection so the todo write and its stamps commit in
//! one transaction.

use rusqlite::{Connection, params};

use crate::todos::input::PatchTodo;
use crate::todos::types::{Todo, TodoStatus};
use crate::todos_github::reconcile::TouchTimes;

const TRACKED_FIELDS: [&str; 3] = ["title", "body", "state"];

fn stamp(db: &Connection, todo_id: &str, field: &str, at: &str) -> rusqlite::Result<()> {
    db.execute(
        "INSERT INTO github_touch (todo_id, field, changed_at) VALUES (?, ?, ?)
         ON CONFLICT(todo_id, field) DO UPDATE SET changed_at = excluded.changed_at",
        params![todo_id, field, at],
    )?;
    Ok(())
}

/// A freshly created todo starts fully "locally recent" — every tracked field
/// stamps at creation time.
pub(crate) fn stamp_create(db: &Connection, todo_id: &str, at: &str) -> rusqlite::Result<()> {
    for field in TRACKED_FIELDS {
        stamp(db, todo_id, field, at)?;
    }
    Ok(())
}

/// Compares the pre-update row against the incoming patch. `title`/`body`
/// stamp only on an actual value change (rewriting the held value stamps
/// nothing); `status` stamps `state` only when the write crosses the `done`
/// boundary. Every other field `patch_todo` accepts is untracked by design.
pub(crate) fn stamp_patch(
    db: &Connection,
    existing: &Todo,
    patch: &PatchTodo,
    at: &str,
) -> rusqlite::Result<()> {
    if patch
        .title
        .as_deref()
        .is_some_and(|title| title != existing.title)
    {
        stamp(db, &existing.id, "title", at)?;
    }
    if patch
        .body
        .as_deref()
        .is_some_and(|body| body != existing.body)
    {
        stamp(db, &existing.id, "body", at)?;
    }
    if let Some(next) = &patch.status {
        stamp_move(db, &existing.id, &existing.status, next, at)?;
    }
    Ok(())
}

/// open↔in_progress never stamps; crossing the `done` boundary in either
/// direction stamps `state`.
pub(crate) fn stamp_move(
    db: &Connection,
    todo_id: &str,
    prev_status: &TodoStatus,
    next_status: &TodoStatus,
    at: &str,
) -> rusqlite::Result<()> {
    if (*prev_status == TodoStatus::Done) != (*next_status == TodoStatus::Done) {
        stamp(db, todo_id, "state", at)?;
    }
    Ok(())
}

/// The touch half of the delete-todo cascade (AC24).
pub(crate) fn clear_for_todo(db: &Connection, todo_id: &str) -> rusqlite::Result<()> {
    db.execute("DELETE FROM github_touch WHERE todo_id = ?", [todo_id])?;
    Ok(())
}

pub(crate) fn touch_times(db: &Connection, todo_id: &str) -> rusqlite::Result<TouchTimes> {
    let mut statement =
        db.prepare("SELECT field, changed_at FROM github_touch WHERE todo_id = ?")?;
    let mut rows = statement.query([todo_id])?;
    let mut times = TouchTimes::default();
    while let Some(row) = rows.next()? {
        let field: String = row.get(0)?;
        let at: Option<String> = row.get(1)?;
        match field.as_str() {
            "title" => times.title_at = at,
            "body" => times.body_at = at,
            "state" => times.state_at = at,
            _ => {}
        }
    }
    Ok(times)
}

#[cfg(test)]
pub(crate) mod testing {
    use std::collections::HashMap;

    use crate::PluginError;
    use crate::context::PluginContext;

    pub(crate) async fn stamp_create(
        ctx: &PluginContext,
        todo_id: &str,
        at: &str,
    ) -> Result<(), PluginError> {
        let (todo_id, at) = (todo_id.to_string(), at.to_string());
        ctx.db()?
            .call(move |db| Ok(super::stamp_create(db, &todo_id, &at)?))
            .await
    }

    /// The stored stamps keyed by field name.
    pub(crate) async fn read_touch(
        ctx: &PluginContext,
        todo_id: &str,
    ) -> Result<HashMap<String, String>, PluginError> {
        let todo_id = todo_id.to_string();
        ctx.db()?
            .call(move |db| {
                let mut statement =
                    db.prepare("SELECT field, changed_at FROM github_touch WHERE todo_id = ?")?;
                let rows = statement
                    .query_map([todo_id], |row| Ok((row.get(0)?, row.get(1)?)))?
                    .collect::<Result<HashMap<_, _>, _>>()?;
                Ok(rows)
            })
            .await
    }
}
