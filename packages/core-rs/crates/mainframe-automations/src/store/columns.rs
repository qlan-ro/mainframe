//! Column readers shared by the store's `FromRow` impls: a JSON column that
//! surfaces malformed data as `StoreError::Corrupt`, and a TEXT column holding
//! a serde `snake_case` enum.

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
