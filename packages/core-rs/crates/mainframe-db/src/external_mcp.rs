use std::rc::Rc;

use mainframe_types::external_mcp::{CreateExternalMcpClient, ExternalMcpClient};
use mainframe_types::time::now_iso8601;
use rusqlite::{Connection, params};

use crate::sql_types::{FromRow, query_all, query_opt};
use crate::{DbError, enum_to_db_string};

pub struct ExternalMcpRepository {
    db: Rc<Connection>,
}

impl ExternalMcpRepository {
    pub fn new(db: Rc<Connection>) -> Self {
        Self { db }
    }

    pub fn create(
        &self,
        input: &CreateExternalMcpClient,
        token_hash: &[u8; 32],
    ) -> Result<ExternalMcpClient, DbError> {
        let client = ExternalMcpClient {
            id: nanoid::nanoid!(),
            name: input.name.trim().to_owned(),
            project_ids: input.project_ids.clone(),
            access: input.access,
            max_permission_mode: input.max_permission_mode,
            answer_prompts: input.answer_prompts,
            created_at: now_iso8601(),
            last_used_at: None,
        };
        self.db.execute(
            "INSERT INTO external_mcp_clients
             (id, name, token_hash, project_ids, access, max_permission_mode, answer_prompts,
              created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                client.id,
                client.name,
                token_hash.as_slice(),
                serde_json::to_string(&client.project_ids)?,
                enum_to_db_string(&client.access)?,
                enum_to_db_string(&client.max_permission_mode)?,
                client.answer_prompts,
                client.created_at
            ],
        )?;
        Ok(client)
    }

    pub fn list(&self) -> Result<Vec<ExternalMcpClient>, DbError> {
        query_all(
            &self.db,
            "SELECT * FROM external_mcp_clients ORDER BY created_at DESC, id",
            [],
        )
    }

    pub fn authenticate(&self, hash: &[u8; 32]) -> Result<Option<ExternalMcpClient>, DbError> {
        let client: Option<ExternalMcpClient> = query_opt(
            &self.db,
            "SELECT * FROM external_mcp_clients WHERE token_hash = ?",
            [hash.as_slice()],
        )?;
        if let Some(client) = &client {
            self.db.execute(
                "UPDATE external_mcp_clients SET last_used_at = ? WHERE id = ?",
                params![now_iso8601(), client.id],
            )?;
        }
        Ok(client)
    }

    pub fn revoke(&self, id: &str) -> Result<(), DbError> {
        self.db
            .execute("DELETE FROM external_mcp_clients WHERE id = ?", [id])?;
        Ok(())
    }
}

impl FromRow for ExternalMcpClient {
    type Error = DbError;

    fn from_row(row: &rusqlite::Row<'_>) -> Result<Self, DbError> {
        let access: String = row.get("access")?;
        let mode: String = row.get("max_permission_mode")?;
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            project_ids: serde_json::from_str(&row.get::<_, String>("project_ids")?)?,
            access: serde_json::from_value(serde_json::Value::String(access))?,
            max_permission_mode: serde_json::from_value(serde_json::Value::String(mode))?,
            answer_prompts: row.get::<_, i64>("answer_prompts")? != 0,
            created_at: row.get("created_at")?,
            last_used_at: row.get("last_used_at")?,
        })
    }
}
