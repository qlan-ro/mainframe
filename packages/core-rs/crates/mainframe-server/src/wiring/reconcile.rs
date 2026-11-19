use crate::Db;
use mainframe_background_tasks::{
    reconcile::{ReconcileSnapshot, reconcile_background_tasks},
    tracker::BackgroundTaskTracker,
};
use std::sync::Arc;
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
            Ok((chats, projects)) => ReconcileSnapshot {
                chats,
                project_paths: projects.into_iter().map(|p| (p.id, p.path)).collect(),
            },
            Err(err) => {
                tracing::warn!(error = %err, "Background task reconciliation failed");
                return;
            }
        };
        reconcile_background_tasks(&tracker, snapshot).await;
    });
}

pub(crate) fn spawn_worktree_backfill(db: Db) {
    tokio::spawn(async move {
        let projects = match db.call(|d| d.projects.list()).await {
            Ok(projects) => projects,
            Err(err) => {
                tracing::warn!(error = %err, "Worktree relationship backfill failed");
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
            tracing::warn!(error = %err, "Worktree relationship backfill failed");
        }
    });
}
