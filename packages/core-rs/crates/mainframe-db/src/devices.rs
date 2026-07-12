//! Ported from `packages/core/src/db/devices.ts`.

use std::rc::Rc;

use mainframe_runtime::time::now_iso8601;
use mainframe_types::device::{Device, DeviceRow};
use rusqlite::Connection;

use crate::DbError;

pub struct DevicesRepository {
    db: Rc<Connection>,
}

impl DevicesRepository {
    pub fn new(db: Rc<Connection>) -> Self {
        Self { db }
    }

    pub fn add(&self, device_id: &str, device_name: &str) -> Result<(), DbError> {
        self.db.execute(
            "INSERT INTO devices (device_id, device_name, created_at)
             VALUES (?, ?, ?)
             ON CONFLICT(device_id) DO UPDATE SET device_name = excluded.device_name",
            rusqlite::params![device_id, device_name, now_iso8601()],
        )?;
        Ok(())
    }

    pub fn remove(&self, device_id: &str) -> Result<(), DbError> {
        self.db
            .execute("DELETE FROM devices WHERE device_id = ?", [device_id])?;
        Ok(())
    }

    pub fn get_all(&self) -> Result<Vec<Device>, DbError> {
        let mut stmt = self
            .db
            .prepare("SELECT device_id, device_name, created_at, last_seen FROM devices ORDER BY created_at DESC")?;
        let rows = stmt.query_map([], |row| {
            Ok(Device {
                device_id: row.get("device_id")?,
                device_name: row.get("device_name")?,
                created_at: row.get("created_at")?,
                last_seen: row.get("last_seen")?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn update_last_seen(&self, device_id: &str) -> Result<(), DbError> {
        self.db.execute(
            "UPDATE devices SET last_seen = ? WHERE device_id = ?",
            rusqlite::params![now_iso8601(), device_id],
        )?;
        Ok(())
    }

    pub fn find_by_device_id(&self, device_id: &str) -> Result<Option<DeviceRow>, DbError> {
        let mut stmt = self.db.prepare(
            "SELECT device_id, device_name, created_at, last_seen, auth_epoch FROM devices WHERE device_id = ?",
        )?;
        let mut rows = stmt.query([device_id])?;
        match rows.next()? {
            Some(row) => Ok(Some(DeviceRow {
                device: Device {
                    device_id: row.get("device_id")?,
                    device_name: row.get("device_name")?,
                    created_at: row.get("created_at")?,
                    last_seen: row.get("last_seen")?,
                },
                auth_epoch: row.get("auth_epoch")?,
            })),
            None => Ok(None),
        }
    }

    pub fn increment_auth_epoch(&self, device_id: &str) -> Result<i64, DbError> {
        match self.db.query_row(
            "UPDATE devices SET auth_epoch = auth_epoch + 1 WHERE device_id = ? RETURNING auth_epoch",
            [device_id],
            |row| row.get::<_, i64>(0),
        ) {
            Ok(value) => Ok(value),
            // No row updated → mirror the TS `?? 0`.
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(0),
            Err(err) => Err(err.into()),
        }
    }
}

// PORT STATUS: src/db/devices.ts (64 lines)
// confidence: high
// notes: DeviceRow composes the flattened Device + authEpoch (types crate).
// incrementAuthEpoch uses UPDATE ... RETURNING; QueryReturnedNoRows maps to 0
// (the TS `?? 0`). now_iso8601() keeps the `new Date().toISOString()` format.
// Tests in tests/devices.rs (devices.test.ts builds its own devices table).
// todos: 0
