use rusqlite::Connection;

use crate::DbError;
use crate::migrations::{LATEST_VERSION, run_migrations};

pub fn initialize_schema(db: &Connection) -> Result<(), DbError> {
    run_migrations(db, LATEST_VERSION)
}
