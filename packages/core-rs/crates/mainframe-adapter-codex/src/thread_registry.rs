//! Ported from `packages/core/src/plugins/builtin/codex/thread-registry.ts`.
//!
//! Reads `~/.codex/state_5.sqlite` (Codex's own thread registry, read-only) to
//! look up sub-agent metadata not exposed via app-server JSON-RPC:
//!   - `agent_nickname` (e.g. "Maxwell")
//!   - `agent_role`     (e.g. "explorer") — used as the TaskGroup card title
//!
//! Falls back gracefully if the DB or row is missing.

use std::collections::HashMap;
use std::path::PathBuf;

use rusqlite::{Connection, OpenFlags};

#[derive(Debug, Clone, PartialEq)]
pub struct AgentMetadata {
    pub nickname: Option<String>,
    pub role: Option<String>,
    pub rollout_path: Option<String>,
}

/// `~/.codex/state_5.sqlite`.
fn db_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".codex").join("state_5.sqlite"))
}

/// Look up agent_nickname/agent_role/rollout_path for the given Codex thread ids.
/// Returns a map keyed by threadId; missing rows are simply absent. Safe to call
/// when the DB doesn't exist (returns an empty map and logs once).
pub fn lookup_agent_metadata(thread_ids: &[String]) -> HashMap<String, AgentMetadata> {
    let mut result: HashMap<String, AgentMetadata> = HashMap::new();
    if thread_ids.is_empty() {
        return result;
    }

    let Some(path) = db_path() else {
        return result;
    };
    if std::fs::metadata(&path).is_err() {
        tracing::debug!(
            module = "codex:thread-registry",
            db_path = %path.display(),
            "codex state DB not accessible — agent name lookup skipped"
        );
        return result;
    }

    match read_metadata(&path, thread_ids) {
        Ok(rows) => {
            for (id, meta) in rows {
                result.insert(id, meta);
            }
        }
        Err(err) => {
            tracing::warn!(
                module = "codex:thread-registry",
                err = %err,
                "codex: failed to read thread registry"
            );
        }
    }
    result
}

fn read_metadata(
    path: &PathBuf,
    thread_ids: &[String],
) -> Result<Vec<(String, AgentMetadata)>, rusqlite::Error> {
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let placeholders = thread_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT id, agent_nickname, agent_role, rollout_path FROM threads WHERE id IN ({placeholders})"
    );
    let mut stmt = db.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(thread_ids.iter()), |row| {
        Ok((
            row.get::<_, String>(0)?,
            AgentMetadata {
                nickname: row.get::<_, Option<String>>(1)?,
                role: row.get::<_, Option<String>>(2)?,
                rollout_path: row.get::<_, Option<String>>(3)?,
            },
        ))
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// The agent's role (e.g. "explorer") — best for the card subtitle.
pub fn describe_agent(meta: Option<&AgentMetadata>) -> Option<String> {
    let meta = meta?;
    meta.role.clone().or_else(|| meta.nickname.clone())
}

/// The agent's nickname (e.g. "Maxwell") — used as the card title (subagent_type).
pub fn agent_title(meta: Option<&AgentMetadata>) -> Option<String> {
    let meta = meta?;
    meta.nickname.clone().or_else(|| meta.role.clone())
}

// PORT STATUS: src/plugins/builtin/codex/thread-registry.ts (72 lines)
// confidence: high
// todos: 0
// notes: better-sqlite3 (sync, read-only) -> rusqlite Connection::open_with_flags
// notes: (READ_ONLY). Kept SYNCHRONOUS to mirror the TS (called from the sync
// notes: event-mapper path); it is a one-shot read of an EXTERNAL Codex DB, not the
// notes: daemon's own store, so it does not route through mainframe-db's Db actor.
// notes: describe_agent/agent_title return Option<String> (TS `string | null`).
