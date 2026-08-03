//! A single row lookup shared by `import`'s post-insert number read and
//! `mod.rs`'s pairing annotation for `list_remote_issues`.

use crate::PluginError;
use crate::context::PluginContext;
use crate::db_context::text;

pub(super) async fn fetch_todo_number(
    ctx: &PluginContext,
    todo_id: &str,
) -> Result<Option<i64>, PluginError> {
    let row = ctx
        .db
        .query_one(
            "SELECT number FROM todos WHERE id = ?".into(),
            vec![text(todo_id.to_string())],
        )
        .await?;
    Ok(row.and_then(|row| row.get("number").and_then(serde_json::Value::as_i64)))
}
