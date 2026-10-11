//! Per-connection file-watch bookkeeping (lives inside the connection's own
//! state, guarded by that connection's mutex) plus subscribe-path resolution:
//! resolving a client-supplied path to an absolute, containment-validated path,
//! with the chat→project ownership check.

use std::collections::{HashMap, HashSet};

use crate::ctx::AppCtx;
use mainframe_services::files::FileWatcherService;

use mainframe_runtime::fs::resolve_and_validate_path;

/// Composite map key so the same relative path under different projects/chats
/// never collides. Mirrors `compositeKey`.
pub(crate) fn composite_key(
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
    /// regular file (logged as a warning; no ack is sent).
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
                tracing::warn!( error = %err, path = %resolved.display(), "subscribe:file rejected: stat failed");
                return None;
            }
        }
        let resolved = resolved.to_string_lossy().into_owned();

        if !self.file_subscriptions.contains(&resolved) {
            self.file_subscriptions.insert(resolved.clone());
            // Key/emit by the realpath (client contract); watch the original path
            // so notify's macOS FSEvents backend actually fires (see subscribe).
            file_watcher.subscribe(&resolved, absolute_path);
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
    pub(crate) fn unsubscribe_all(&mut self, file_watcher: &FileWatcherService) {
        for path in self.file_subscriptions.drain() {
            file_watcher.unsubscribe(&path);
        }
        self.requested_to_resolved.clear();
    }
}

/// Rejects unknown chats and missing worktrees before relative-path containment checks.
pub(crate) async fn resolve_subscribe_base(
    ctx: &AppCtx,
    project_id: &str,
    chat_id: Option<&str>,
) -> Option<String> {
    match ctx.resolve_scope(project_id, chat_id).await {
        Ok(scope) => Some(scope.path),
        Err(error) => {
            tracing::debug!(%error, "file subscription scope unavailable");
            None
        }
    }
}

/// Containment-validate a relative `requested_path` against `base` (async
/// realpath), matching the `resolveAndValidatePath(base, requested)` tail of
/// `resolveSubscribePath`.
pub(crate) async fn validate_relative(base: &str, requested_path: &str) -> Option<String> {
    resolve_and_validate_path(base, requested_path).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn file_subscription_rejects_unknown_chat_but_accepts_project_scope() {
        let ctx = AppCtx::test_ctx();
        let project = ctx
            .core
            .db
            .call(|db| db.projects.create("/workspace", None))
            .await
            .unwrap();
        assert_eq!(
            resolve_subscribe_base(&ctx, &project.id, Some("unknown")).await,
            None
        );
        assert_eq!(
            resolve_subscribe_base(&ctx, &project.id, None).await,
            Some(project.path)
        );
    }
}
