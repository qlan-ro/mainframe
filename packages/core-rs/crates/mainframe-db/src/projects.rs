//! Ported from `packages/core/src/db/projects.ts`.

use std::path::Path;
use std::rc::Rc;

use mainframe_runtime::time::now_iso8601;
use mainframe_types::chat::Project;
use rusqlite::{Connection, OptionalExtension};

use crate::DbError;

const PROJECT_SELECT: &str = "SELECT id, name, path, created_at as createdAt, last_opened_at as lastOpenedAt, \
     parent_project_id as parentProjectId FROM projects";

pub struct ProjectsRepository {
    db: Rc<Connection>,
}

fn row_to_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get("id")?,
        name: row.get("name")?,
        path: row.get("path")?,
        created_at: row.get("createdAt")?,
        last_opened_at: row.get("lastOpenedAt")?,
        // parent_project_id is nullable but always present as a column → the
        // tri-state field is Some(None) for NULL, Some(Some(_)) for a value.
        parent_project_id: Some(row.get::<_, Option<String>>("parentProjectId")?),
    })
}

impl ProjectsRepository {
    pub fn new(db: Rc<Connection>) -> Self {
        Self { db }
    }

    pub fn list(&self) -> Result<Vec<Project>, DbError> {
        let mut stmt = self
            .db
            .prepare(&format!("{PROJECT_SELECT} ORDER BY last_opened_at DESC"))?;
        let rows = stmt.query_map([], row_to_project)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn get(&self, id: &str) -> Result<Option<Project>, DbError> {
        Ok(self
            .db
            .query_row(
                &format!("{PROJECT_SELECT} WHERE id = ?"),
                [id],
                row_to_project,
            )
            .optional()?)
    }

    pub fn get_by_path(&self, path: &str) -> Result<Option<Project>, DbError> {
        Ok(self
            .db
            .query_row(
                &format!("{PROJECT_SELECT} WHERE path = ?"),
                [path],
                row_to_project,
            )
            .optional()?)
    }

    pub fn create(&self, path: &str, name: Option<&str>) -> Result<Project, DbError> {
        let id = nanoid::nanoid!();
        let now = now_iso8601();
        let project_name = match name {
            Some(n) if !n.is_empty() => n.to_string(),
            _ => Path::new(path)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.to_string()),
        };

        self.db.execute(
            "INSERT INTO projects (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)",
            rusqlite::params![id, project_name, path, now, now],
        )?;

        Ok(Project {
            id,
            name: project_name,
            path: path.to_string(),
            created_at: now.clone(),
            last_opened_at: now,
            parent_project_id: Some(None),
        })
    }

    pub fn update_last_opened(&self, id: &str) -> Result<(), DbError> {
        self.db.execute(
            "UPDATE projects SET last_opened_at = ? WHERE id = ?",
            rusqlite::params![now_iso8601(), id],
        )?;
        Ok(())
    }

    pub fn remove(&self, id: &str) -> Result<(), DbError> {
        let tx = self.db.unchecked_transaction()?;
        tx.execute(
            "UPDATE projects SET parent_project_id = NULL WHERE parent_project_id = ?",
            [id],
        )?;
        tx.execute("DELETE FROM chats WHERE project_id = ?", [id])?;
        tx.execute("DELETE FROM projects WHERE id = ?", [id])?;
        tx.commit()?;
        Ok(())
    }

    pub fn set_parent_project(&self, project_id: &str, parent_id: &str) -> Result<(), DbError> {
        self.db.execute(
            "UPDATE projects SET parent_project_id = ? WHERE id = ?",
            rusqlite::params![parent_id, project_id],
        )?;
        Ok(())
    }

    pub fn clear_parent_project(&self, parent_id: &str) -> Result<(), DbError> {
        self.db.execute(
            "UPDATE projects SET parent_project_id = NULL WHERE parent_project_id = ?",
            [parent_id],
        )?;
        Ok(())
    }
}

// PORT STATUS: src/db/projects.ts (77 lines)
// confidence: high
// notes: Project.parent_project_id is the types crate's tri-state
// Option<Option<String>>; DB NULL → Some(None) (serializes null), value →
// Some(Some(_)), matching the TS spread where the key is always present.
// create()'s basename() fallback uses Path::file_name(). remove() uses
// unchecked_transaction() (Rc<Connection> can't yield &mut Connection); RAII drop
// rolls back on error, matching db.transaction(). now_iso8601() preserves the
// `new Date().toISOString()` wire format. Tests in tests/projects.rs.
// todos: 0
