use crate::DbError;
use crate::migrate::run_versioned;
pub use crate::migrate::{Migration, add_column_if_missing};
use rusqlite::Connection;
mod base;
mod orchestration;
mod special;
pub(crate) mod v31_segments;

macro_rules! column {
    ($version:expr, $table:literal, $column:literal, $ddl:literal) => {
        Migration {
            version: $version,
            up: |db| add_column_if_missing(db, $table, $column, $ddl),
        }
    };
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        up: special::v1,
    },
    column!(
        2,
        "chats",
        "title",
        "ALTER TABLE chats ADD COLUMN title TEXT"
    ),
    column!(
        3,
        "chats",
        "mentions",
        "ALTER TABLE chats ADD COLUMN mentions TEXT DEFAULT '[]'"
    ),
    column!(
        4,
        "chats",
        "modified_files",
        "ALTER TABLE chats ADD COLUMN modified_files TEXT DEFAULT '[]'"
    ),
    column!(
        5,
        "chats",
        "plan_files",
        "ALTER TABLE chats ADD COLUMN plan_files TEXT DEFAULT '[]'"
    ),
    column!(
        6,
        "chats",
        "skill_files",
        "ALTER TABLE chats ADD COLUMN skill_files TEXT DEFAULT '[]'"
    ),
    column!(
        7,
        "chats",
        "permission_mode",
        "ALTER TABLE chats ADD COLUMN permission_mode TEXT"
    ),
    column!(
        8,
        "chats",
        "worktree_path",
        "ALTER TABLE chats ADD COLUMN worktree_path TEXT"
    ),
    column!(
        9,
        "chats",
        "branch_name",
        "ALTER TABLE chats ADD COLUMN branch_name TEXT"
    ),
    column!(
        10,
        "chats",
        "process_state",
        "ALTER TABLE chats ADD COLUMN process_state TEXT"
    ),
    column!(
        11,
        "chats",
        "last_context_tokens_input",
        "ALTER TABLE chats ADD COLUMN last_context_tokens_input INTEGER DEFAULT 0"
    ),
    column!(
        12,
        "chats",
        "todos",
        "ALTER TABLE chats ADD COLUMN todos TEXT"
    ),
    column!(
        13,
        "chats",
        "pinned",
        "ALTER TABLE chats ADD COLUMN pinned INTEGER DEFAULT 0"
    ),
    column!(
        14,
        "chats",
        "effort",
        "ALTER TABLE chats ADD COLUMN effort TEXT"
    ),
    column!(
        15,
        "chats",
        "fast",
        "ALTER TABLE chats ADD COLUMN fast INTEGER"
    ),
    column!(
        16,
        "chats",
        "ultracode",
        "ALTER TABLE chats ADD COLUMN ultracode INTEGER"
    ),
    column!(
        17,
        "chats",
        "adaptive_thinking",
        "ALTER TABLE chats ADD COLUMN adaptive_thinking INTEGER"
    ),
    column!(
        18,
        "chats",
        "detected_prs",
        "ALTER TABLE chats ADD COLUMN detected_prs TEXT DEFAULT '[]'"
    ),
    Migration {
        version: 19,
        up: special::v19,
    },
    column!(
        20,
        "chats",
        "session_file_path",
        "ALTER TABLE chats ADD COLUMN session_file_path TEXT"
    ),
    Migration {
        version: 21,
        up: special::v21,
    },
    column!(
        22,
        "projects",
        "parent_project_id",
        "ALTER TABLE projects ADD COLUMN parent_project_id TEXT REFERENCES projects(id)"
    ),
    column!(
        23,
        "devices",
        "auth_epoch",
        "ALTER TABLE devices ADD COLUMN auth_epoch INTEGER NOT NULL DEFAULT 0"
    ),
    Migration {
        version: 24,
        up: special::v24,
    },
    Migration {
        version: 25,
        up: special::v25,
    },
    column!(
        26,
        "chats",
        "automation_run_id",
        "ALTER TABLE chats ADD COLUMN automation_run_id TEXT"
    ),
    column!(
        27,
        "chats",
        "dismissed_worktrees",
        "ALTER TABLE chats ADD COLUMN dismissed_worktrees TEXT"
    ),
    Migration {
        version: 28,
        up: special::v28,
    },
    Migration {
        version: 29,
        up: special::v29,
    },
    Migration {
        version: 30,
        up: special::v30,
    },
    Migration {
        version: 31,
        up: v31_segments::up,
    },
    Migration {
        version: orchestration::VERSION,
        up: orchestration::up,
    },
];

pub fn migrations() -> Vec<Migration> {
    MIGRATIONS.to_vec()
}

pub const LATEST_VERSION: i64 = 32;

pub fn run_migrations(db: &Connection, target: i64) -> Result<(), DbError> {
    run_versioned(db, &migrations(), target)
}
