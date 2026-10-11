use crate::Db;
use mainframe_background_tasks::{
    reconcile::{ReconcileDb, ReconcileDeps, reconcile_background_tasks},
    tracker::BackgroundTaskTracker,
};
use mainframe_types::chat::Chat;
use std::{collections::HashMap, sync::Arc};
pub(crate) fn spawn_reconcile(db: Db, tracker: Arc<BackgroundTaskTracker>) {
    tokio::spawn(async move {
        let snapshot = match db
            .call(|d| {
                let chats = d.chats.list_all()?;
                let projects = d.projects.list()?;
                Ok((chats, projects))
            })
            .await
        {
            Ok((chats, projects)) => SnapshotReconcileDb {
                chats,
                project_paths: projects.into_iter().map(|p| (p.id, p.path)).collect(),
            },
            Err(err) => {
                tracing::warn!(%err, "Background task reconciliation failed");
                return;
            }
        };
        reconcile_background_tasks(ReconcileDeps {
            tracker: &tracker,
            db: &snapshot,
            spool_root: None,
            validator: None,
        })
        .await;
    });
}

pub(crate) fn spawn_worktree_backfill(db: Db) {
    tokio::spawn(async move {
        let projects = match db.call(|d| d.projects.list()).await {
            Ok(projects) => projects,
            Err(err) => {
                tracing::warn!(%err, "Worktree relationship backfill failed");
                return;
            }
        };
        let links = mainframe_services::workspace::compute_worktree_parent_links(&projects).await;
        if links.is_empty() {
            return;
        }
        let result = db
            .call(move |d| {
                for (child_id, parent_id) in &links {
                    tracing::info!(
                        module = "worktree-backfill",
                        child_id = %child_id,
                        parent_id = %parent_id,
                        "Backfilling worktree relationship"
                    );
                    d.projects.set_parent_project(child_id, parent_id)?;
                }
                Ok(())
            })
            .await;
        if let Err(err) = result {
            tracing::warn!(%err, "Worktree relationship backfill failed");
        }
    });
}

struct SnapshotReconcileDb {
    chats: Vec<Chat>,
    project_paths: HashMap<String, String>,
}

impl ReconcileDb for SnapshotReconcileDb {
    fn chats_list_all(&self) -> Vec<Chat> {
        self.chats.clone()
    }
    fn project_path(&self, id: &str) -> Option<String> {
        self.project_paths.get(id).cloned()
    }
}
