use super::ChatsRepository;
use crate::DbError;

impl ChatsRepository {
    pub fn clear_worktree_bases_for_branches(
        &self,
        project_id: &str,
        branch: &str,
        other: Option<&str>,
    ) -> Result<Vec<String>, DbError> {
        let mut stmt = self.db.prepare(
            "UPDATE chats SET base_branch = NULL
             WHERE project_id = ? AND branch_name IN (?, ?) AND base_branch IS NOT NULL
             RETURNING id",
        )?;
        let rows = stmt.query_map(rusqlite::params![project_id, branch, other], |row| {
            row.get(0)
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }
}
