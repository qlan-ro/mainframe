//! Typed reads and writes for the `todos` table, all through the plugin's
//! SQLite actor.

use mainframe_db::sql_types::{JsonCol, query_all, query_opt};
use rusqlite::params;
use rusqlite::types::Value as SqlValue;

use super::input::{CreateTodo, PatchTodo};
use super::types::{Todo, TodoStatus};
use crate::PluginError;
use crate::context::PluginContext;
use crate::db_context::text;

const INSERT: &str = "INSERT INTO todos (id, number, project_id, title, body, status, type, priority, labels, assignees, milestone, dependencies, order_index, created_at, updated_at) \
     VALUES (?1, (SELECT COALESCE(MAX(number), 0) + 1 FROM todos WHERE project_id = ?2), ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, ?12, ?12)";

pub(super) async fn fetch(ctx: &PluginContext, id: &str) -> Result<Option<Todo>, PluginError> {
    let id = id.to_string();
    ctx.db
        .actor()?
        .call(move |db| query_opt(db, "SELECT * FROM todos WHERE id = ?", [id]))
        .await
}

pub(super) async fn exists(ctx: &PluginContext, id: &str) -> Result<bool, PluginError> {
    Ok(fetch(ctx, id).await?.is_some())
}

pub(super) async fn list(ctx: &PluginContext, project_id: &str) -> Result<Vec<Todo>, PluginError> {
    let project_id = project_id.to_string();
    ctx.db
        .actor()?
        .call(move |db| {
            query_all(
                db,
                "SELECT * FROM todos WHERE project_id = ? ORDER BY status, order_index, created_at",
                [project_id],
            )
        })
        .await
}

/// Resolve a todo's dependency numbers within its project, skipping missing ones.
pub(super) async fn dependencies(
    ctx: &PluginContext,
    todo: &Todo,
) -> Result<Vec<Todo>, PluginError> {
    let project_id = todo.project_id.clone();
    let numbers = todo.dependencies.clone();
    ctx.db
        .actor()?
        .call(move |db| {
            let mut found = Vec::new();
            for number in numbers {
                let todo = query_opt(
                    db,
                    "SELECT * FROM todos WHERE number = ? AND project_id = ?",
                    params![number, project_id],
                )?;
                found.extend(todo);
            }
            Ok(found)
        })
        .await
}

pub(super) async fn insert(
    ctx: &PluginContext,
    id: &str,
    input: CreateTodo,
    now: &str,
) -> Result<(), PluginError> {
    let (id, now) = (id.to_string(), now.to_string());
    ctx.db
        .actor()?
        .call(move |db| {
            db.execute(
                INSERT,
                params![
                    id,
                    input.project_id,
                    input.title,
                    input.body,
                    input.status.as_str(),
                    input.type_field.as_str(),
                    input.priority.as_str(),
                    JsonCol(&input.labels),
                    JsonCol(&input.assignees),
                    input.milestone,
                    JsonCol(&input.dependencies),
                    now,
                ],
            )?;
            Ok(())
        })
        .await
}

pub(super) async fn update(
    ctx: &PluginContext,
    id: &str,
    patch: &PatchTodo,
    now: &str,
) -> Result<(), PluginError> {
    let (sets, mut values) = assignments(patch, now)?;
    values.push(text(id));
    let sql = format!("UPDATE todos SET {} WHERE id = ?", sets.join(", "));
    ctx.db
        .actor()?
        .call(move |db| {
            db.execute(&sql, rusqlite::params_from_iter(values))?;
            Ok(())
        })
        .await
}

type Assignments = (Vec<&'static str>, Vec<SqlValue>);

fn assignments(patch: &PatchTodo, now: &str) -> Result<Assignments, PluginError> {
    let mut sets = vec!["updated_at = ?"];
    let mut values = vec![text(now)];
    let mut set = |column: &'static str, value: SqlValue| {
        sets.push(column);
        values.push(value);
    };
    if let Some(title) = &patch.title {
        set("title = ?", text(title));
    }
    if let Some(body) = &patch.body {
        set("body = ?", text(body));
    }
    if let Some(status) = &patch.status {
        set("status = ?", text(status.as_str()));
    }
    if let Some(kind) = &patch.type_field {
        set("type = ?", text(kind.as_str()));
    }
    if let Some(priority) = &patch.priority {
        set("priority = ?", text(priority.as_str()));
    }
    if let Some(labels) = &patch.labels {
        set("labels = ?", text(serde_json::to_string(labels)?));
    }
    if let Some(assignees) = &patch.assignees {
        set("assignees = ?", text(serde_json::to_string(assignees)?));
    }
    if let Some(milestone) = &patch.milestone {
        set("milestone = ?", text(milestone));
    }
    if let Some(dependencies) = &patch.dependencies {
        set(
            "dependencies = ?",
            text(serde_json::to_string(dependencies)?),
        );
    }
    Ok((sets, values))
}

pub(super) async fn set_status(
    ctx: &PluginContext,
    id: &str,
    status: &TodoStatus,
    now: &str,
) -> Result<(), PluginError> {
    let (id, now, status) = (id.to_string(), now.to_string(), status.as_str().to_string());
    ctx.db
        .actor()?
        .call(move |db| {
            db.execute(
                "UPDATE todos SET status = ?, updated_at = ? WHERE id = ?",
                params![status, now, id],
            )?;
            Ok(())
        })
        .await
}

/// Removes the todo and its GitHub pair row together.
pub(super) async fn delete(ctx: &PluginContext, id: &str) -> Result<(), PluginError> {
    let id = id.to_string();
    ctx.db
        .actor()?
        .call_mut(move |db| {
            let transaction = db.transaction()?;
            transaction.execute("DELETE FROM github_pairs WHERE todo_id = ?", [&id])?;
            transaction.execute("DELETE FROM todos WHERE id = ?", [&id])?;
            transaction.commit()?;
            Ok(())
        })
        .await
}
