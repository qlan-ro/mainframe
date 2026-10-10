//! The `DatabaseManager` handle, migration runner, schema, and the
//! repositories.
//!
//! The API is synchronous (rusqlite, a single shared connection). Async
//! wrapping (`spawn_blocking`, the `Db` handle) lives in `mainframe-server::db`.
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
mod relocation;
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
/// human string whose exact text is preserved (several are asserted by regex in
/// tests and cross the wire).
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
/// `"active"`).
pub(crate) fn enum_to_db_string<T: serde::Serialize>(value: &T) -> Result<String, DbError> {
    match serde_json::to_value(value)? {
        serde_json::Value::String(s) => Ok(s),
        other => Err(DbError::Message(format!(
            "expected string enum, got {other}"
        ))),
    }
}

/// Owns the single SQLite connection and exposes the repositories. The
/// connection is shared with each repository via `Rc<Connection>`
/// (single-threaded, synchronous — one shared handle).
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
    /// Opens the daemon database at `db_path` (`<dataDir>/mainframe.db`). A
    /// database found only at `legacy_db_path` is moved there first; if that
    /// move fails, the legacy database is opened for this boot instead.
    pub fn new(db_path: &Path, legacy_db_path: &Path) -> Result<Self, DbError> {
        let db_path = relocation::resolve_database_path(db_path, legacy_db_path);
        if let Some(dir) = db_path.parent() {
            std::fs::create_dir_all(dir)?;
        }
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

    /// Closes the connection. It drops when the last `Rc` is released, so this
    /// consumes `self` to make the intent visible.
    pub fn close(self) {
        drop(self);
    }

    /// Escape hatch for tests / lower-level callers that need the raw handle.
    pub fn connection(&self) -> &Rc<Connection> {
        &self.db
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn creates_the_database_under_a_new_data_directory() {
        let root = tempdir().unwrap();
        let db_path = root.path().join("configured").join("mainframe.db");
        let legacy_db = root.path().join("legacy").join("mainframe.db");

        DatabaseManager::new(&db_path, &legacy_db).unwrap().close();

        assert!(db_path.exists());
        assert!(!root.path().join("legacy").exists());
    }

    #[test]
    fn opens_a_moved_legacy_database_with_its_data() {
        let root = tempdir().unwrap();
        let db_path = root.path().join("configured").join("mainframe.db");
        let legacy_db = root.path().join("mainframe.db");
        let conn = Connection::open(&legacy_db).unwrap();
        conn.execute_batch("CREATE TABLE migration_proof (value TEXT); INSERT INTO migration_proof VALUES ('kept');").unwrap();
        drop(conn);

        let db = DatabaseManager::new(&db_path, &legacy_db).unwrap();
        let value: String = db
            .connection()
            .query_row("SELECT value FROM migration_proof", [], |row| row.get(0))
            .unwrap();

        assert_eq!(value, "kept");
        assert!(!legacy_db.exists());
    }
}
