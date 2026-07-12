//! CRUD for the `automations` table. Definition validation (schema + token
//! scopes) is the service layer's job — this store persists and reads the
//! already-validated definition it is handed.

use nanoid::nanoid;
use rusqlite::{Connection, Row, params};

use crate::domain::{AutomationCreateInput, AutomationDefinition, AutomationScope};
use crate::error::StoreError;

use super::{AutomationDb, AutomationRecord, epoch_ms_now, parse_db_enum};

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
            .call(|conn| {
                let mut stmt = conn.prepare("SELECT * FROM automations ORDER BY created_at")?;
                let rows = stmt.query_map([], row_to_parts)?;
                rows.map(|r| parts_to_record(r?)).collect()
            })
            .await
    }

    pub async fn list_enabled(&self) -> Result<Vec<AutomationRecord>, StoreError> {
        self.db
            .call(|conn| {
                let mut stmt = conn
                    .prepare("SELECT * FROM automations WHERE enabled = 1 ORDER BY created_at")?;
                let rows = stmt.query_map([], row_to_parts)?;
                rows.map(|r| parts_to_record(r?)).collect()
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
    /// Idempotent — deleting a missing automation is a no-op, like Node's.
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

/// Raw column values, pulled out of the `Row` before the fallible JSON parse
/// (rusqlite's `query_map` closure can only fail with `rusqlite::Error`).
struct RowParts {
    id: String,
    name: String,
    description: Option<String>,
    scope: String,
    project_id: Option<String>,
    enabled: i64,
    definition: String,
    created_at: i64,
    updated_at: i64,
}

fn row_to_parts(row: &Row<'_>) -> rusqlite::Result<RowParts> {
    Ok(RowParts {
        id: row.get("id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        scope: row.get("scope")?,
        project_id: row.get("project_id")?,
        enabled: row.get("enabled")?,
        definition: row.get("definition")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn parts_to_record(parts: RowParts) -> Result<AutomationRecord, StoreError> {
    let definition: AutomationDefinition =
        serde_json::from_str(&parts.definition).map_err(|source| StoreError::Corrupt {
            what: "automation definition",
            id: parts.id.clone(),
            source,
        })?;
    let scope: AutomationScope = parse_db_enum(&parts.scope, "automation scope", &parts.id)?;
    Ok(AutomationRecord {
        id: parts.id,
        name: parts.name,
        description: parts.description,
        scope,
        project_id: parts.project_id,
        enabled: parts.enabled != 0,
        definition,
        created_at: parts.created_at,
        updated_at: parts.updated_at,
    })
}

fn get_by_id(conn: &Connection, id: &str) -> Result<Option<AutomationRecord>, StoreError> {
    let mut stmt = conn.prepare("SELECT * FROM automations WHERE id = ?1")?;
    let mut rows = stmt.query_map(params![id], row_to_parts)?;
    match rows.next() {
        Some(parts) => Ok(Some(parts_to_record(parts?)?)),
        None => Ok(None),
    }
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

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T2.2), not a TS port
// confidence: high
// todos: 0
// notes: mirrors Node's store/automation-store.ts CRUD surface; the webhook
//        hookId scan lands with the trigger router (T8.3).
