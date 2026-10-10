use crate::DbError;
use rusqlite::Connection;

type MigrationFn = fn(&Connection) -> Result<(), DbError>;

#[derive(Clone, Copy)]
pub struct Migration {
    pub version: i64,
    pub up: MigrationFn,
}

pub fn has_column(db: &Connection, table: &str, column: &str) -> Result<bool, DbError> {
    Ok(db.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info(?) WHERE name = ?)",
        [table, column],
        |row| row.get(0),
    )?)
}

pub fn add_column_if_missing(
    db: &Connection,
    table: &str,
    column: &str,
    ddl: &str,
) -> Result<(), DbError> {
    if !has_column(db, table, column)? {
        db.execute_batch(ddl)?;
    }
    Ok(())
}

pub fn run_versioned(
    db: &Connection,
    migrations: &[Migration],
    target: i64,
) -> Result<(), DbError> {
    let current: i64 = db.pragma_query_value(None, "user_version", |row| row.get(0))?;
    for migration in migrations {
        if migration.version > current && migration.version <= target {
            let transaction = db.unchecked_transaction()?;
            (migration.up)(&transaction)?;
            transaction.pragma_update(None, "user_version", migration.version)?;
            transaction.commit()?;
        }
    }
    Ok(())
}

pub fn run_batch(db: &Connection, sql: &str) -> rusqlite::Result<()> {
    let transaction = db.unchecked_transaction()?;
    transaction.execute_batch(sql)?;
    transaction.commit()
}
