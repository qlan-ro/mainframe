//! Typed reads and writes for the `todos` table, all through the plugin's
//! SQLite actor. A write that also stamps the GitHub touch map commits both
//! in one transaction.

use mainframe_db::sql_types::{JsonCol, query_all, query_opt};
use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, params};

use super::input::{CreateTodo, PatchTodo};
use super::types::{Todo, TodoStatus};
use crate::PluginError;
use crate::context::PluginContext;
use crate::todos_github::touch;

const INSERT: &str = "INSERT INTO todos (id, number, project_id, title, body, status, type, priority, labels, assignees, milestone, dependencies, order_index, created_at, updated_at) \
     VALUES (?1, (SELECT COALESCE(MAX(number), 0) + 1 FROM todos WHERE project_id = ?2), ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, ?12, ?12) \
     RETURNING number";

pub(crate) fn fetch_in(db: &Connection, id: &str) -> Result<Option<Todo>, PluginError> {
    query_opt(db, "SELECT * FROM todos WHERE id = ?", [id])
}

pub(crate) async fn fetch(ctx: &PluginContext, id: &str) -> Result<Option<Todo>, PluginError> {
    let id = id.to_string();
    ctx.db()?.call(move |db| fetch_in(db, &id)).await
}

pub(super) async fn exists(ctx: &PluginContext, id: &str) -> Result<bool, PluginError> {
    Ok(fetch(ctx, id).await?.is_some())
}

pub(super) async fn list(ctx: &PluginContext, project_id: &str) -> Result<Vec<Todo>, PluginError> {
    let project_id = project_id.to_string();
    ctx.db()?
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
    ctx.db()?
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

/// Inserts a todo with the next number in its project and returns that
/// number. Stamps nothing.
pub(crate) fn insert_row(
    db: &Connection,
    id: &str,
    input: &CreateTodo,
    now: &str,
) -> rusqlite::Result<i64> {
    db.query_row(
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
        |row| row.get(0),
    )
}

/// Inserts a todo created through the board, stamping every tracked field.
pub(super) async fn insert(
    ctx: &PluginContext,
    id: &str,
    input: CreateTodo,
    now: &str,
) -> Result<(), PluginError> {
    let (id, now) = (id.to_string(), now.to_string());
    ctx.db()?
        .call_mut(move |db| {
            let transaction = db.transaction()?;
            insert_row(&transaction, &id, &input, &now)?;
            touch::stamp_create(&transaction, &id, &now)?;
            transaction.commit()?;
            Ok(())
        })
        .await
}

/// Applies `patch` to `existing` and stamps the fields it changed.
pub(super) async fn update(
    ctx: &PluginContext,
    existing: &Todo,
    patch: &PatchTodo,
    now: &str,
) -> Result<(), PluginError> {
    let (sets, mut values) = assignments(patch, now)?;
    values.push(SqlValue::Text(existing.id.clone()));
    let sql = format!("UPDATE todos SET {} WHERE id = ?", sets.join(", "));
    let (existing, patch, now) = (existing.clone(), patch.clone(), now.to_string());
    ctx.db()?
        .call_mut(move |db| {
            let transaction = db.transaction()?;
            transaction.execute(&sql, rusqlite::params_from_iter(values))?;
            touch::stamp_patch(&transaction, &existing, &patch, &now)?;
            transaction.commit()?;
            Ok(())
        })
        .await
}

type Assignments = (Vec<&'static str>, Vec<SqlValue>);

fn assignments(patch: &PatchTodo, now: &str) -> Result<Assignments, PluginError> {
    let mut sets = vec!["updated_at = ?"];
    let mut values = vec![SqlValue::Text(now.to_string())];
    let mut set = |column: &'static str, value: &str| {
        sets.push(column);
        values.push(SqlValue::Text(value.to_string()));
    };
    if let Some(title) = &patch.title {
        set("title = ?", title);
    }
    if let Some(body) = &patch.body {
        set("body = ?", body);
    }
    if let Some(status) = &patch.status {
        set("status = ?", status.as_str());
    }
    if let Some(kind) = &patch.type_field {
        set("type = ?", kind.as_str());
    }
    if let Some(priority) = &patch.priority {
        set("priority = ?", priority.as_str());
    }
    if let Some(labels) = &patch.labels {
        set("labels = ?", &serde_json::to_string(labels)?);
    }
    if let Some(assignees) = &patch.assignees {
        set("assignees = ?", &serde_json::to_string(assignees)?);
    }
    if let Some(milestone) = &patch.milestone {
        set("milestone = ?", milestone);
    }
    if let Some(dependencies) = &patch.dependencies {
        set("dependencies = ?", &serde_json::to_string(dependencies)?);
    }
    Ok((sets, values))
}

/// Moves a todo to `status`, stamping `state` when the move crosses `done`.
pub(super) async fn set_status(
    ctx: &PluginContext,
    id: &str,
    previous: &TodoStatus,
    status: &TodoStatus,
    now: &str,
) -> Result<(), PluginError> {
    let (id, now) = (id.to_string(), now.to_string());
    let (previous, status) = (previous.clone(), status.clone());
    ctx.db()?
        .call_mut(move |db| {
            let transaction = db.transaction()?;
            transaction.execute(
                "UPDATE todos SET status = ?, updated_at = ? WHERE id = ?",
                params![status.as_str(), now, id],
            )?;
            touch::stamp_move(&transaction, &id, &previous, &status, &now)?;
            transaction.commit()?;
            Ok(())
        })
        .await
}

/// Removes the todo with its touch stamps and GitHub pair row.
pub(super) async fn delete(ctx: &PluginContext, id: &str) -> Result<(), PluginError> {
    let id = id.to_string();
    ctx.db()?
        .call_mut(move |db| {
            let transaction = db.transaction()?;
            touch::clear_for_todo(&transaction, &id)?;
            transaction.execute("DELETE FROM github_pairs WHERE todo_id = ?", [&id])?;
            transaction.execute("DELETE FROM todos WHERE id = ?", [&id])?;
            transaction.commit()?;
            Ok(())
        })
        .await
}
