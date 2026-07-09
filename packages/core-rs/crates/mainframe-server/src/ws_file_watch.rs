//! Ported from `src/server/ws-file-watch.ts`.
//!
//! Per-connection file-watch bookkeeping (PER_ENTITY per CONCURRENCY.tsv — lives
//! inside the connection's own state, guarded by that connection's mutex) plus
//! `resolveSubscribePath`: resolving a client-supplied path to an absolute,
//! containment-validated path, with the chat→project ownership check.

use std::collections::{HashMap, HashSet};

use mainframe_db::DatabaseManager;
use mainframe_services::files::FileWatcherService;

use crate::path_utils::resolve_and_validate_path;

/// Composite map key so the same relative path under different projects/chats
/// never collides. Mirrors `compositeKey`.
pub fn composite_key(
    requested_path: &str,
    project_id: Option<&str>,
    chat_id: Option<&str>,
) -> String {
    format!(
        "{}|{}|{}",
        project_id.unwrap_or(""),
        chat_id.unwrap_or(""),
        requested_path
    )
}

/// Per-client file-watch state. Tracks the resolved absolute paths this client
/// watches and maps a composite key → resolved path.
#[derive(Default)]
pub struct WsFileWatch {
    file_subscriptions: HashSet<String>,
    requested_to_resolved: HashMap<String, String>,
}

impl WsFileWatch {
    /// Realpath + is-file check, then register the watch (once per resolved path)
    /// and record the composite mapping. Returns `(requestedPath, resolvedPath)`
    /// for the `subscribe:file:ack`, or `None` if the file is missing / not a
    /// regular file (the TS logs a warn and returns without acking).
    pub async fn subscribe(
        &mut self,
        requested_path: &str,
        absolute_path: &str,
        file_watcher: &FileWatcherService,
        project_id: Option<&str>,
        chat_id: Option<&str>,
    ) -> Option<(String, String)> {
        let resolved = match tokio::fs::canonicalize(absolute_path).await {
            Ok(p) => p,
            Err(_) => {
                tracing::warn!(
                    path = absolute_path,
                    "subscribe:file rejected: realpath failed"
                );
                return None;
            }
        };
        match tokio::fs::metadata(&resolved).await {
            Ok(meta) if meta.is_file() => {}
            Ok(_) => {
                tracing::warn!(path = %resolved.display(), "subscribe:file rejected: not a regular file");
                return None;
            }
            Err(err) => {
                tracing::warn!(%err, path = %resolved.display(), "subscribe:file rejected: stat failed");
                return None;
            }
        }
        let resolved = resolved.to_string_lossy().into_owned();

        if !self.file_subscriptions.contains(&resolved) {
            self.file_subscriptions.insert(resolved.clone());
            file_watcher.subscribe(&resolved);
        }
        self.requested_to_resolved.insert(
            composite_key(requested_path, project_id, chat_id),
            resolved.clone(),
        );
        Some((requested_path.to_string(), resolved))
    }

    /// Remove the watch registered under this composite key. No-op if unknown.
    pub fn unsubscribe(
        &mut self,
        requested_path: &str,
        file_watcher: &FileWatcherService,
        project_id: Option<&str>,
        chat_id: Option<&str>,
    ) {
        let key = composite_key(requested_path, project_id, chat_id);
        let Some(resolved) = self.requested_to_resolved.remove(&key) else {
            return;
        };
        self.file_subscriptions.remove(&resolved);
        file_watcher.unsubscribe(&resolved);
    }

    /// Drop every watch this client holds (on socket close).
    pub fn unsubscribe_all(&mut self, file_watcher: &FileWatcherService) {
        for path in self.file_subscriptions.drain() {
            file_watcher.unsubscribe(&path);
        }
        self.requested_to_resolved.clear();
    }
}

/// The base directory for a *relative* `subscribe:file`, with the chat→project
/// ownership check. Runs on the DB thread (sync repo access) — the caller then
/// containment-validates the requested path against this base. Mirrors the
/// non-absolute branch of `resolveSubscribePath`; returns `None` (reject) on a
/// missing projectId, an ownership mismatch, or an unresolvable base.
///
/// Absolute paths are handled by the caller (returned as-is, no base) exactly as
/// the TS `if (requestedPath.startsWith('/')) return requestedPath;` fast-path.
pub fn resolve_subscribe_base(
    db: &DatabaseManager,
    project_id: &str,
    chat_id: Option<&str>,
) -> Option<String> {
    if let Some(cid) = chat_id {
        // Only reject when the chat exists AND belongs to a different project
        // (TS: `chatProjectId !== null && chatProjectId !== projectId`).
        if let Ok(Some(chat)) = db.chats.get(cid)
            && chat.project_id != project_id
        {
            return None;
        }
    }
    match chat_id {
        Some(cid) => effective_path(db, cid),
        None => project_path(db, project_id),
    }
}

/// `ChatManager.getEffectivePath(chatId)` approximation: the chat's stored
/// worktree path if set, else its project's path.
fn effective_path(db: &DatabaseManager, chat_id: &str) -> Option<String> {
    let chat = db.chats.get(chat_id).ok().flatten()?;
    match chat.worktree_path {
        Some(worktree) => Some(worktree),
        None => project_path(db, &chat.project_id),
    }
}

/// `ChatManager.getProjectPath(projectId)`: the project's root path.
fn project_path(db: &DatabaseManager, project_id: &str) -> Option<String> {
    db.projects.get(project_id).ok().flatten().map(|p| p.path)
}

/// Containment-validate a relative `requested_path` against `base` (async
/// realpath), matching the `resolveAndValidatePath(base, requested)` tail of
/// `resolveSubscribePath`.
pub async fn validate_relative(base: &str, requested_path: &str) -> Option<String> {
    resolve_and_validate_path(base, requested_path).await
}

// PORT STATUS: src/server/ws-file-watch.ts (WsFileWatch + resolveSubscribePath)
// confidence: medium
// todos: 1
// notes: WsFileWatch is per-connection PER_ENTITY state (guarded by the
// connection mutex in websocket.rs). `resolveSubscribePath` is split: the
// db-dependent base resolution + ownership check (`resolve_subscribe_base`) runs
// on the DB thread; the async realpath containment check (`validate_relative`)
// runs on the caller task. TODO(port-phase4): `effective_path` approximates
// ChatManager.getEffectivePath by reading the chat's stored `worktree_path`; the
// full live-worktree validation lands with the ChatManager port.
