//! Ported from `packages/core/src/db/*` — the `DatabaseManager` handle,
//! migration runner, schema, and the six repositories.
//!
//! `better-sqlite3` is synchronous; this port keeps the synchronous API
//! (rusqlite, a single shared connection). Async wrapping (`spawn_blocking`,
//! `Db` handle) is a later phase and intentionally NOT added here.
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

use std::path::{Path, PathBuf};
use std::rc::Rc;

use rusqlite::Connection;

pub mod chat_tags;
pub mod chats;
pub mod devices;
pub mod migrations;
pub mod projects;
pub mod schema;
pub mod settings;
pub mod tag_color;
pub mod tags;
pub mod validate_tag_name;

pub use chat_tags::ChatTagsRepository;
pub use chats::{ChatListFilters, ChatUpdate, ChatsRepository};
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

/// Mirrors `config.ts`'s `getDataDir()`. Not yet available from
/// `mainframe_runtime::config` (only the `DAEMON_PORT` override is ported there),
/// so it is replicated here for `DatabaseManager::new()`.
fn get_data_dir() -> Result<PathBuf, DbError> {
    // TODO(port): delegate to mainframe_runtime::config::get_data_dir once that
    // ports the dataDir path (only DAEMON_PORT is ported there today).
    // `??` in the TS is nullish-only: an unset var falls back, an empty string
    // does not. `env::var` returns `Err` only when unset, so this matches.
    let dir = match std::env::var("MAINFRAME_DATA_DIR") {
        Ok(value) => PathBuf::from(value),
        Err(_) => dirs::home_dir()
            .ok_or_else(|| DbError::Message("could not resolve home directory".into()))?
            .join(".mainframe"),
    };
    if !dir.exists() {
        std::fs::create_dir_all(&dir)?;
    }
    Ok(dir)
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
}

impl DatabaseManager {
    /// Opens `~/.mainframe/mainframe.db` (or `$MAINFRAME_DATA_DIR/mainframe.db`),
    /// enabling WAL + foreign keys, then runs migrations.
    pub fn new() -> Result<Self, DbError> {
        let db_path = get_data_dir()?.join("mainframe.db");
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

        Ok(Self {
            db,
            projects,
            chats,
            settings,
            devices,
            tags,
            chat_tags,
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
// foreign_keys pragmas, initializeSchema). getDataDir() is replicated locally
// pending mainframe_runtime::config porting the dataDir path (see the inline
// deferral marker at get_data_dir). Repositories share one Rc<Connection> (single-threaded,
// synchronous) — Phase B replaces this with the async Db handle / spawn_blocking.
// close() consumes self (Rust drops the connection when the last Rc is released).
// DbError + enum_to_db_string are crate-wide helpers with no TS counterpart.
// todos: 1
