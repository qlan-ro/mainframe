//! `ChatManager::sweep_unreferenced_fork_snapshots` — moved out of
//! `fork_api.rs` to keep that file under the 300-line ceiling once `fork_chat`
//! grew the from-message path.
use super::*;

impl ChatManager {
    /// Startup sweep: remove any directory directly under
    /// `fork_snapshots_dir()` that no chat's `pending_fork` currently
    /// references. Covers a crash between pin and the DB insert (the chat row
    /// was never created, so `on_result` never runs to retire it) and project
    /// removal (which deletes chat rows directly, bypassing retirement too).
    /// Best-effort throughout: every failure is logged, never surfaced.
    pub async fn sweep_unreferenced_fork_snapshots(&self) {
        let root = self.deps.fork_snapshots_dir();
        let referenced: std::collections::HashSet<String> = self
            .deps
            .chats_list_all()
            .into_iter()
            .filter_map(|chat| self.deps.get_pending_fork(&chat.id))
            .map(|pending| pending.snapshot_dir)
            .collect();

        let mut entries = match tokio::fs::read_dir(&root).await {
            Ok(entries) => entries,
            // Nothing has ever been pinned — the directory doesn't exist yet.
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return,
            Err(err) => {
                tracing::warn!(
                    %err,
                    root,
                    "fork-snapshot sweep: failed to list the snapshots directory"
                );
                return;
            }
        };
        loop {
            let entry = match entries.next_entry().await {
                Ok(Some(entry)) => entry,
                Ok(None) => break,
                Err(err) => {
                    tracing::warn!(%err, root, "fork-snapshot sweep: failed to read an entry");
                    break;
                }
            };
            let path = entry.path().to_string_lossy().into_owned();
            if referenced.contains(&path) {
                continue;
            }
            if let Err(err) = tokio::fs::remove_dir_all(&path).await {
                tracing::warn!(
                    %err,
                    path,
                    "fork-snapshot sweep: failed to remove an unreferenced snapshot directory"
                );
            } else {
                tracing::info!(
                    path,
                    "fork-snapshot sweep: removed an unreferenced snapshot directory"
                );
            }
        }
    }
}
