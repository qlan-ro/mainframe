//! Column readers shared by the store's `FromRow` impls: a JSON column that
//! surfaces malformed data as `StoreError::Corrupt`, and a TEXT column holding
//! a serde `snake_case` enum.
//!
//! Corruption policy: unlike the chat, todo and tag rows, which log and read a
//! bad column as its default, these readers fail the row. An automation run's
//! checkpoint is the durable state the engine resumes from; a defaulted step
//! status or output would silently re-run or skip side-effecting steps after a
//! restart. So a corrupt run is never reconstructed: boot reconcile
//! (`RunStore::list_live_runs`) logs it, finalizes it `failed` in place and
//! carries on with the other runs.

use rusqlite::Row;
use serde::de::DeserializeOwned;

use crate::error::StoreError;

use super::parse_db_enum;

pub(super) fn json_column<T: DeserializeOwned>(
    row: &Row<'_>,
    column: &str,
    what: &'static str,
    id: &str,
) -> Result<T, StoreError> {
    let raw: String = row.get(column)?;
    serde_json::from_str(&raw).map_err(|source| StoreError::Corrupt {
        what,
        id: id.to_string(),
        source,
    })
}

pub(super) fn enum_column<T: DeserializeOwned>(
    row: &Row<'_>,
    column: &str,
    what: &'static str,
    id: &str,
) -> Result<T, StoreError> {
    let raw: String = row.get(column)?;
    parse_db_enum(&raw, what, id)
}
