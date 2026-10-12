use rusqlite::Connection;
use std::{path::Path, time::Duration};

#[derive(Default)]
pub struct OpenOptions {
    pub busy_timeout: Option<Duration>,
}

pub fn open_sqlite(path: &Path, options: OpenOptions) -> rusqlite::Result<Connection> {
    let connection = Connection::open(path)?;
    connection.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
    if let Some(timeout) = options.busy_timeout {
        connection.busy_timeout(timeout)?;
    }
    Ok(connection)
}
