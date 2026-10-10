use mainframe_db::sql_types::{query_all, query_opt};
use rusqlite::types::Value as SqlValue;
use crate::{PluginError, context::PluginContext, db_context::{int, nullable_text, text}};
use super::{input::{CreateTodo, PatchTodo}, types::Todo};

pub(super) async fn fetch_row(ctx: &PluginContext, id: &str) -> Result<Option<Todo>, PluginError> {
    let id = id.to_string();
    ctx.db.actor()?.call(move |db| query_opt(db, "SELECT * FROM todos WHERE id = ?", [id])).await
}

pub(super) async fn list(ctx: &PluginContext, project_id: &str) -> Result<Vec<Todo>, PluginError> {
    let project = project_id.to_string();
    ctx.db.actor()?.call(move |db| query_all(db,
        "SELECT * FROM todos WHERE project_id = ? ORDER BY status, order_index, created_at", [project])).await
}

pub(super) async fn fetch_id(ctx: &PluginContext, id: &str) -> Result<bool, PluginError> {
    Ok(fetch_row(ctx, id).await?.is_some())
}

pub(super) async fn load_dependencies(ctx: &PluginContext, todo: &Todo) -> Result<Vec<Todo>, PluginError> {
    let project = todo.project_id.clone();
    let dependencies = todo.dependencies.clone();
    ctx.db.actor()?.call(move |db| {
        let mut values = Vec::new();
        for number in dependencies {
            if let Some(todo) = query_opt(db, "SELECT * FROM todos WHERE number = ? AND project_id = ?", rusqlite::params![number, project])? {
                values.push(todo);
            }
        }
        Ok(values)
    }).await
}

pub(super) async fn insert(ctx: &PluginContext, id: &str, input: CreateTodo, now: &str) -> Result<(), PluginError> {
    let params = vec![text(id), text(input.project_id.clone()), text(input.project_id),
        text(input.title), text(input.body), text(input.status.as_str()), text(input.type_field.as_str()),
        text(input.priority.as_str()), text(serde_json::to_string(&input.labels)?),
        text(serde_json::to_string(&input.assignees)?), nullable_text(input.milestone),
        text(serde_json::to_string(&input.dependencies)?), int(0), text(now), text(now)];
    ctx.db.execute("INSERT INTO todos (id,number,project_id,title,body,status,type,priority,labels,assignees,milestone,dependencies,order_index,created_at,updated_at) VALUES (?, (SELECT COALESCE(MAX(number), 0) + 1 FROM todos WHERE project_id = ?), ?,?,?,?,?,?,?,?,?,?,?,?,?)".into(), params).await
}

pub(super) async fn update(ctx: &PluginContext, id: &str, input: &PatchTodo, now: &str) -> Result<(), PluginError> {
    let (sets, mut values) = assignments(input, now)?;
    values.push(text(id));
    ctx.db.execute(format!("UPDATE todos SET {} WHERE id = ?", sets.join(", ")), values).await
}

fn assignments(input: &PatchTodo, now: &str) -> Result<(Vec<&'static str>, Vec<SqlValue>), PluginError> {
    let mut sets = vec!["updated_at = ?"];
    let mut values = vec![text(now)];
    macro_rules! set {
        ($field:ident, $column:literal, $encode:expr) => {
            if let Some(value) = &input.$field {
                sets.push(concat!($column, " = ?"));
                values.push(text(($encode)(value)));
            }
        };
    }
    set!(title, "title", |v: &String| v.clone());
    set!(body, "body", |v: &String| v.clone());
    set!(status, "status", |v: &super::types::TodoStatus| v.as_str());
    set!(type_field, "type", |v: &super::types::TodoType| v.as_str());
    set!(priority, "priority", |v: &super::types::TodoPriority| v.as_str());
    set!(labels, "labels", |v: &Vec<String>| serde_json::to_string(v).map_err(PluginError::from)?);
    set!(assignees, "assignees", |v: &Vec<String>| serde_json::to_string(v).map_err(PluginError::from)?);
    set!(milestone, "milestone", |v: &String| v.clone());
    set!(dependencies, "dependencies", |v: &Vec<i64>| serde_json::to_string(v).map_err(PluginError::from)?);
    Ok((sets, values))
}
