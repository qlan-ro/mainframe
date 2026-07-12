//! Ported from `packages/core/src/db/schema.ts`.

use rusqlite::Connection;

use crate::DbError;
use crate::migrations::{LATEST_VERSION, run_migrations};

pub fn initialize_schema(db: &Connection) -> Result<(), DbError> {
    run_migrations(db, LATEST_VERSION)
}

// PORT STATUS: src/db/schema.ts (6 lines)
// confidence: high
// notes: thin delegate to run_migrations at LATEST_VERSION; the TS default
// parameter becomes an explicit target argument. Tests live in
// tests/schema.rs (ported from schema.test.ts / session-file-path-migration.test.ts).
// todos: 0
