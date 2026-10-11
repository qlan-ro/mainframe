use super::*;

pub(super) fn insert_fork_row(
    db: &rusqlite::Connection,
    insert: &ForkInsert<'_>,
    id: &str,
    now: &str,
) -> Result<(), DbError> {
    let permission_bind = insert
        .permission_mode
        .as_ref()
        .map(enum_to_db_string)
        .transpose()?;
    let effort_bind = insert.effort.as_ref().map(enum_to_db_string).transpose()?;
    let pending_fork_json = serde_json::to_string(insert.pending_fork)?;

    db.execute(
        "INSERT INTO chats (
                id, adapter_id, project_id, model, permission_mode, plan_mode,
                effort, fast, ultracode, adaptive_thinking,
                worktree_path, branch_name, title,
                parent_chat_id, pending_fork,
                status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)",
        rusqlite::params![
            id,
            insert.adapter_id,
            insert.project_id,
            insert.model,
            permission_bind,
            i64::from(insert.plan_mode),
            effort_bind,
            insert.fast.map(i64::from),
            insert.ultracode.map(i64::from),
            insert.adaptive_thinking.map(i64::from),
            insert.worktree_path,
            insert.branch_name,
            insert.title,
            insert.parent_chat_id,
            pending_fork_json,
            now,
            now,
        ],
    )?;
    Ok(())
}
