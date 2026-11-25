use super::ChatsRepository;
use crate::DbError;

pub struct ClearedWorktreeBase {
    pub chat_id: String,
    pub project_id: String,
    pub worktree_path: Option<String>,
    pub branch_name: String,
}

impl ChatsRepository {
    pub fn projects_with_worktree_bases(
        &self,
        branch: &str,
        other: Option<&str>,
    ) -> Result<Vec<(String, String)>, DbError> {
        let mut stmt = self.db.prepare(
            "SELECT DISTINCT projects.id, projects.path
             FROM chats JOIN projects ON projects.id = chats.project_id
             WHERE branch_name IN (?, ?) AND base_branch IS NOT NULL",
        )?;
        let rows = stmt.query_map(rusqlite::params![branch, other], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn clear_worktree_bases_for_branches(
        &self,
        projects: Option<&[String]>,
        branch: &str,
        other: Option<&str>,
    ) -> Result<Vec<ClearedWorktreeBase>, DbError> {
        let projects = projects.map(serde_json::to_string).transpose()?;
        let mut stmt = self.db.prepare(
            "UPDATE chats SET base_branch = NULL
             WHERE (?1 IS NULL OR project_id IN (SELECT value FROM json_each(?1)))
             AND branch_name IN (?2, ?3) AND base_branch IS NOT NULL
             RETURNING id, project_id, worktree_path, branch_name",
        )?;
        let rows = stmt.query_map(rusqlite::params![projects, branch, other], |row| {
            Ok(ClearedWorktreeBase {
                chat_id: row.get(0)?,
                project_id: row.get(1)?,
                worktree_path: row.get(2)?,
                branch_name: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }
}
