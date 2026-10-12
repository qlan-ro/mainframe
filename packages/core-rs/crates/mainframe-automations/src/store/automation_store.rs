//! CRUD for the `automations` table. Definition validation (schema + token
//! scopes) is the service layer's job — this store persists and reads the
//! already-validated definition it is handed.

use mainframe_db::sql_types::{FromRow, SqlBool, query_all, query_opt};
use nanoid::nanoid;
use rusqlite::{Connection, Row, params};

use crate::domain::{AutomationCreateInput, AutomationScope};
use crate::error::StoreError;

use super::columns::{enum_column, json_column};
use super::{AutomationDb, AutomationRecord, epoch_ms_now};

#[derive(Clone)]
pub struct AutomationStore {
    db: AutomationDb,
}

impl AutomationStore {
    pub fn new(db: AutomationDb) -> Self {
        Self { db }
    }

    pub async fn create(
        &self,
        input: AutomationCreateInput,
    ) -> Result<AutomationRecord, StoreError> {
        self.db
            .call(move |conn| {
                let id = nanoid!();
                let now = epoch_ms_now();
                conn.execute(
                    "INSERT INTO automations (id, name, description, scope, project_id, enabled, definition, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?7)",
                    params![
                        id,
                        input.name,
                        input.description,
                        scope_to_db(input.scope),
                        input.project_id,
                        serde_json::to_string(&input.definition)?,
                        now,
                    ],
                )?;
                require(conn, &id)
            })
            .await
    }

    pub async fn get(&self, id: &str) -> Result<Option<AutomationRecord>, StoreError> {
        let id = id.to_string();
        self.db.call(move |conn| get_by_id(conn, &id)).await
    }

    pub async fn list(&self) -> Result<Vec<AutomationRecord>, StoreError> {
        self.db
            .call(|conn| query_all(conn, "SELECT * FROM automations ORDER BY created_at", []))
            .await
    }

    pub(crate) async fn list_enabled(&self) -> Result<Vec<AutomationRecord>, StoreError> {
        self.db
            .call(|conn| {
                query_all(
                    conn,
                    "SELECT * FROM automations WHERE enabled = 1 ORDER BY created_at",
                    [],
                )
            })
            .await
    }

    pub async fn update(
        &self,
        id: &str,
        input: AutomationCreateInput,
    ) -> Result<AutomationRecord, StoreError> {
        let id = id.to_string();
        self.db
            .call(move |conn| {
                let changed = conn.execute(
                    "UPDATE automations SET name = ?2, description = ?3, scope = ?4, project_id = ?5, definition = ?6, updated_at = ?7 WHERE id = ?1",
                    params![
                        id,
                        input.name,
                        input.description,
                        scope_to_db(input.scope),
                        input.project_id,
                        serde_json::to_string(&input.definition)?,
                        epoch_ms_now(),
                    ],
                )?;
                if changed == 0 {
                    return Err(not_found(&id));
                }
                require(conn, &id)
            })
            .await
    }

    pub async fn set_enabled(
        &self,
        id: &str,
        enabled: bool,
    ) -> Result<AutomationRecord, StoreError> {
        let id = id.to_string();
        self.db
            .call(move |conn| {
                let changed = conn.execute(
                    "UPDATE automations SET enabled = ?2, updated_at = ?3 WHERE id = ?1",
                    params![id, enabled as i64, epoch_ms_now()],
                )?;
                if changed == 0 {
                    return Err(not_found(&id));
                }
                require(conn, &id)
            })
            .await
    }

    /// Runs and interactions cascade via the ON DELETE CASCADE FKs (db.rs).
    /// Idempotent — deleting a missing automation is a no-op.
    pub async fn delete(&self, id: &str) -> Result<(), StoreError> {
        let id = id.to_string();
        self.db
            .call(move |conn| {
                conn.execute("DELETE FROM automations WHERE id = ?1", params![id])?;
                Ok(())
            })
            .await
    }
}

impl FromRow for AutomationRecord {
    type Error = StoreError;

    fn from_row(row: &Row<'_>) -> Result<Self, StoreError> {
        let id: String = row.get("id")?;
        Ok(Self {
            name: row.get("name")?,
            description: row.get("description")?,
            scope: enum_column(row, "scope", "automation scope", &id)?,
            project_id: row.get("project_id")?,
            enabled: row.get::<_, SqlBool>("enabled")?.0,
            definition: json_column(row, "definition", "automation definition", &id)?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            id,
        })
    }
}

fn get_by_id(conn: &Connection, id: &str) -> Result<Option<AutomationRecord>, StoreError> {
    query_opt(conn, "SELECT * FROM automations WHERE id = ?1", [id])
}

fn require(conn: &Connection, id: &str) -> Result<AutomationRecord, StoreError> {
    get_by_id(conn, id)?.ok_or_else(|| not_found(id))
}

fn not_found(id: &str) -> StoreError {
    StoreError::NotFound {
        kind: "automation",
        id: id.to_string(),
    }
}

fn scope_to_db(scope: AutomationScope) -> &'static str {
    match scope {
        AutomationScope::Global => "global",
        AutomationScope::Project => "project",
    }
}
