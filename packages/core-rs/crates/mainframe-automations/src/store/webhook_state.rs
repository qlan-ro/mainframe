//! Per-hook delivery state. Keyed by `hook_id` rather than by automation id
//! so ingest — which resolves a hook before it knows the automation — can
//! record a delivery with the id it was given.

use rusqlite::{OptionalExtension, params};

use crate::error::StoreError;

use super::AutomationDb;

#[derive(Clone)]
pub struct WebhookStateStore {
    db: AutomationDb,
}

impl WebhookStateStore {
    pub fn new(db: AutomationDb) -> Self {
        Self { db }
    }

    /// Stamps the hook's last accepted delivery. `at` is an RFC 3339 string:
    /// the value goes straight to the wire, and the editor renders it.
    pub async fn record_delivery(&self, hook_id: &str, at: &str) -> Result<(), StoreError> {
        let hook_id = hook_id.to_string();
        let at = at.to_string();
        self.db
            .call(move |conn| {
                conn.execute(
                    "INSERT INTO automation_webhook_state (hook_id, last_delivery_at)
                     VALUES (?1, ?2)
                     ON CONFLICT(hook_id) DO UPDATE SET last_delivery_at = excluded.last_delivery_at",
                    params![hook_id, at],
                )?;
                Ok(())
            })
            .await
    }

    pub async fn last_delivery_at(&self, hook_id: &str) -> Result<Option<String>, StoreError> {
        let hook_id = hook_id.to_string();
        self.db
            .call(move |conn| {
                let found = conn
                    .query_row(
                        "SELECT last_delivery_at FROM automation_webhook_state WHERE hook_id = ?1",
                        params![hook_id],
                        |row| row.get::<_, Option<String>>(0),
                    )
                    .optional()?;
                Ok(found.flatten())
            })
            .await
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-25-todo-234-automations-editor-plan.md T7), not a TS port
// confidence: high
// todos: 0
// notes: the fourth table in automations.db; Node has no equivalent, so a
//        file handed back to that engine simply ignores it.
