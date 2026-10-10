//! Ported from `packages/core/src/db/*` — the `DatabaseManager` handle,
//! migration runner, schema, and the six repositories.
//!
//! `better-sqlite3` is synchronous; this port keeps the synchronous API
//! (rusqlite, a single shared connection). Async wrapping (`spawn_blocking`,
//! `Db` handle) is a later phase and intentionally NOT added here.
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

use std::path::Path;
use std::rc::Rc;

use rusqlite::Connection;

pub mod chat_handoffs;
mod chat_native_sessions;
pub mod chat_segments;
mod chat_segments_fork;
mod chat_segments_repo;
mod chat_segments_switch;
pub mod chat_tags;
pub mod chats;
pub mod delegated_tasks;
pub mod devices;
pub mod migrations;
mod orchestration;
pub mod projects;
pub mod schema;
pub mod settings;
mod side_chats;
pub mod tag_color;
pub mod tags;
pub mod validate_tag_name;

pub use chat_handoffs::HandoffsRepository;
pub use chat_segments::{RecordOutcome, SegmentResultDelta, SegmentsRepository};
pub use chat_tags::ChatTagsRepository;
pub use chats::{ChatListFilters, ChatUpdate, ChatsRepository, ForkInsert, PendingFork};
pub use delegated_tasks::DelegatedTasksRepository;
pub use devices::DevicesRepository;
pub use projects::ProjectsRepository;
pub use settings::SettingsRepository;
pub use tags::TagsRepository;

/// Fallible-operation error for the whole DB layer. `Message` carries a verbatim
/// human string so `throw new Error(msg)` sites round-trip their exact text
/// (several are asserted by regex in the ported tests and cross the wire later).
#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Message(String),
}

/// Serialize a serde enum to its wire/DB string (e.g. `ChatStatus::Active` →
/// `"active"`). Mirrors the implicit string cast the TS repositories rely on.
pub(crate) fn enum_to_db_string<T: serde::Serialize>(value: &T) -> Result<String, DbError> {
    match serde_json::to_value(value)? {
        serde_json::Value::String(s) => Ok(s),
        other => Err(DbError::Message(format!(
            "expected string enum, got {other}"
        ))),
    }
}

fn migrate_legacy_database(data_dir: &Path, legacy_data_dir: &Path) -> Result<(), DbError> {
    let target = data_dir.join("mainframe.db");
    let legacy = legacy_data_dir.join("mainframe.db");
    if data_dir == legacy_data_dir || target.exists() || !legacy.exists() {
        return Ok(());
    }

    std::fs::create_dir_all(data_dir)?;
    let files = ["mainframe.db-wal", "mainframe.db-shm", "mainframe.db"];
    for name in files {
        let source = legacy_data_dir.join(name);
        let destination = data_dir.join(name);
        if source.exists() && destination.exists() {
            return Err(DbError::Message(format!(
                "cannot migrate database: {} already exists",
                destination.display()
            )));
        }
    }
    tracing::info!(from = %legacy_data_dir.display(), to = %data_dir.display(), "migrating database to configured data directory");
    for name in files {
        let source = legacy_data_dir.join(name);
        if source.exists() {
            std::fs::rename(&source, data_dir.join(name))?;
        }
    }
    Ok(())
}

/// Owns the single SQLite connection and exposes the repositories, mirroring the
/// TS `DatabaseManager`. The connection is shared with each repository via
/// `Rc<Connection>` (single-threaded, synchronous — one shared handle, exactly
/// like `better-sqlite3`).
pub struct DatabaseManager {
    db: Rc<Connection>,
    pub projects: ProjectsRepository,
    pub chats: ChatsRepository,
    pub settings: SettingsRepository,
    pub devices: DevicesRepository,
    pub tags: TagsRepository,
    pub chat_tags: ChatTagsRepository,
    pub segments: SegmentsRepository,
    pub handoffs: HandoffsRepository,
    pub delegated_tasks: DelegatedTasksRepository,
}

impl DatabaseManager {
    /// Opens the database under the merged config directory, moving a legacy
    /// database there when the configured directory has no database yet.
    pub fn new(data_dir: &Path, legacy_data_dir: &Path) -> Result<Self, DbError> {
        migrate_legacy_database(data_dir, legacy_data_dir)?;
        std::fs::create_dir_all(data_dir)?;
        let db_path = data_dir.join("mainframe.db");
        Self::open(&db_path)
    }

    /// Opens the DB at `db_path` (creating it if absent), applies the WAL +
    /// foreign-keys pragmas, and runs the migration chain.
    pub fn open(db_path: &Path) -> Result<Self, DbError> {
        let conn = Connection::open(db_path)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;

        schema::initialize_schema(&conn)?;

        let db = Rc::new(conn);
        let projects = ProjectsRepository::new(Rc::clone(&db));
        let tags = TagsRepository::new(Rc::clone(&db));
        let chat_tags = ChatTagsRepository::new(Rc::clone(&db));
        // Pass chatTags into ChatsRepository so list/get can populate Chat.tags.
        let chats = ChatsRepository::new(Rc::clone(&db), Some(chat_tags.clone()));
        let settings = SettingsRepository::new(Rc::clone(&db));
        let devices = DevicesRepository::new(Rc::clone(&db));
        let segments = SegmentsRepository::new(Rc::clone(&db));
        let handoffs = HandoffsRepository::new(Rc::clone(&db));
        let delegated_tasks = DelegatedTasksRepository::new(Rc::clone(&db));

        Ok(Self {
            db,
            projects,
            chats,
            settings,
            devices,
            tags,
            chat_tags,
            segments,
            handoffs,
            delegated_tasks,
        })
    }

    /// Closes the connection. `better-sqlite3`'s `close()` is explicit; in Rust
    /// the connection drops when the last `Rc` is released, so this consumes
    /// `self` to make the intent visible.
    pub fn close(self) {
        drop(self);
    }

    /// Escape hatch for tests / lower-level callers that need the raw handle.
    pub fn connection(&self) -> &Rc<Connection> {
        &self.db
    }
}

// PORT STATUS: src/db/index.ts (49 lines)
// confidence: medium
// notes: `DatabaseManager` mirrors the TS class (pub repo fields, WAL +
// foreign_keys pragmas, initializeSchema). Repositories share one Rc<Connection> (single-threaded,
// synchronous) — Phase B replaces this with the async Db handle / spawn_blocking.
// close() consumes self (Rust drops the connection when the last Rc is released).
// DbError + enum_to_db_string are crate-wide helpers with no TS counterpart.
// todos: 0

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn opens_database_in_configured_directory() {
        let root = tempdir().unwrap();
        let data_dir = root.path().join("configured");
        let legacy = root.path().join("legacy");
        DatabaseManager::new(&data_dir, &legacy).unwrap().close();
        assert!(data_dir.join("mainframe.db").exists());
        assert!(!legacy.join("mainframe.db").exists());
    }

    #[test]
    fn moves_legacy_database_and_sidecars_before_opening() {
        let root = tempdir().unwrap();
        let data_dir = root.path().join("configured");
        let legacy = root.path().join("legacy");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("mainframe.db"), b"legacy db").unwrap();
        std::fs::write(legacy.join("mainframe.db-wal"), b"wal").unwrap();
        std::fs::write(legacy.join("mainframe.db-shm"), b"shm").unwrap();

        migrate_legacy_database(&data_dir, &legacy).unwrap();

        assert_eq!(
            std::fs::read(data_dir.join("mainframe.db")).unwrap(),
            b"legacy db"
        );
        assert_eq!(
            std::fs::read(data_dir.join("mainframe.db-wal")).unwrap(),
            b"wal"
        );
        assert_eq!(
            std::fs::read(data_dir.join("mainframe.db-shm")).unwrap(),
            b"shm"
        );
        assert!(!legacy.join("mainframe.db").exists());
    }

    #[test]
    fn opens_migrated_database_with_existing_data() {
        let root = tempdir().unwrap();
        let data_dir = root.path().join("configured");
        let legacy = root.path().join("legacy");
        std::fs::create_dir_all(&legacy).unwrap();
        let conn = Connection::open(legacy.join("mainframe.db")).unwrap();
        conn.execute_batch("CREATE TABLE migration_proof (value TEXT); INSERT INTO migration_proof VALUES ('kept');").unwrap();
        drop(conn);

        let db = DatabaseManager::new(&data_dir, &legacy).unwrap();
        let value: String = db
            .connection()
            .query_row("SELECT value FROM migration_proof", [], |row| row.get(0))
            .unwrap();
        assert_eq!(value, "kept");
        assert!(!legacy.join("mainframe.db").exists());
    }

    #[test]
    fn keeps_existing_configured_database() {
        let root = tempdir().unwrap();
        let data_dir = root.path().join("configured");
        let legacy = root.path().join("legacy");
        std::fs::create_dir_all(&legacy).unwrap();
        DatabaseManager::new(&data_dir, &legacy).unwrap().close();
        std::fs::write(legacy.join("mainframe.db"), b"legacy db").unwrap();

        DatabaseManager::new(&data_dir, &legacy).unwrap().close();

        assert_eq!(
            std::fs::read(legacy.join("mainframe.db")).unwrap(),
            b"legacy db"
        );
    }
}
