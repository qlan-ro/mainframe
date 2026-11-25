use super::ChatsRepository;
use crate::DbError;

#[derive(Clone)]
pub struct ClearedWorktreeBase {
    pub chat_id: String,
    pub project_id: String,
    pub worktree_path: Option<String>,
    pub branch_name: String,
    pub base_branch: String,
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
        projects: &[String],
        branch: &str,
        other: Option<&str>,
    ) -> Result<Vec<ClearedWorktreeBase>, DbError> {
        let projects = serde_json::to_string(projects)?;
        let tx = self.db.unchecked_transaction()?;
        let bases = {
            let mut stmt = tx.prepare(
                "SELECT id, project_id, worktree_path, branch_name, base_branch
                 FROM chats WHERE project_id IN (SELECT value FROM json_each(?))
                 AND branch_name IN (?, ?) AND base_branch IS NOT NULL",
            )?;
            let rows = stmt.query_map(rusqlite::params![projects, branch, other], |row| {
                Ok(ClearedWorktreeBase {
                    chat_id: row.get(0)?,
                    project_id: row.get(1)?,
                    worktree_path: row.get(2)?,
                    branch_name: row.get(3)?,
                    base_branch: row.get(4)?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        tx.execute(
            "UPDATE chats SET base_branch = NULL
             WHERE project_id IN (SELECT value FROM json_each(?))
             AND branch_name IN (?, ?) AND base_branch IS NOT NULL",
            rusqlite::params![projects, branch, other],
        )?;
        tx.commit()?;
        Ok(bases)
    }

    pub fn restore_worktree_bases(
        &self,
        bases: Vec<ClearedWorktreeBase>,
    ) -> Result<Vec<ClearedWorktreeBase>, DbError> {
        let tx = self.db.unchecked_transaction()?;
        let mut restored = Vec::new();
        for base in bases {
            if tx.execute(
                "UPDATE chats SET base_branch = ?
                 WHERE id = ? AND project_id = ? AND worktree_path IS ?
                 AND branch_name = ? AND base_branch IS NULL",
                rusqlite::params![
                    base.base_branch,
                    base.chat_id,
                    base.project_id,
                    base.worktree_path,
                    base.branch_name
                ],
            )? == 1
            {
                restored.push(base);
            }
        }
        tx.commit()?;
        Ok(restored)
    }
}
