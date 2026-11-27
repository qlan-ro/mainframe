//! `github_links` — one row per project, the repo it syncs against.

use mainframe_db::sql_types::{FromRow, query_opt};
use rusqlite::params;

use crate::PluginError;
use crate::context::PluginContext;

use super::prune_runs_in;

#[derive(Debug, Clone, PartialEq)]
pub struct Link {
    pub project_id: String,
    pub owner: String,
    pub repo: String,
    pub remote_name: String,
    pub credential_label: String,
    pub last_synced_at: Option<String>,
    pub created_at: String,
}

impl FromRow for Link {
    type Error = PluginError;

    fn from_row(row: &rusqlite::Row<'_>) -> Result<Self, PluginError> {
        Ok(Self {
            project_id: row.get("project_id")?,
            owner: row.get("owner")?,
            repo: row.get("repo")?,
            remote_name: row.get("remote_name")?,
            credential_label: row.get("credential_label")?,
            last_synced_at: row.get("last_synced_at")?,
            created_at: row.get("created_at")?,
        })
    }
}

/// Creates the project's link. `false` when the project is already linked;
/// the existing row is left as it was.
pub(crate) async fn insert_link(ctx: &PluginContext, link: &Link) -> Result<bool, PluginError> {
    let link = link.clone();
    ctx.db()?
        .call(move |db| {
            let inserted = db.execute(
                "INSERT INTO github_links
                   (project_id, owner, repo, remote_name, credential_label, last_synced_at, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(project_id) DO NOTHING",
                params![
                    link.project_id,
                    link.owner,
                    link.repo,
                    link.remote_name,
                    link.credential_label,
                    link.last_synced_at,
                    link.created_at,
                ],
            )?;
            Ok(inserted == 1)
        })
        .await
}

pub(crate) async fn read_link(
    ctx: &PluginContext,
    project_id: &str,
) -> Result<Option<Link>, PluginError> {
    let project_id = project_id.to_string();
    ctx.db()?
        .call(move |db| {
            query_opt(
                db,
                "SELECT * FROM github_links WHERE project_id = ?",
                [project_id],
            )
        })
        .await
}

/// Removes the link together with every pair, run and report row of the
/// project, in one transaction. Todos and their touch stamps stay.
pub(crate) async fn delete_link(ctx: &PluginContext, project_id: &str) -> Result<(), PluginError> {
    let project_id = project_id.to_string();
    ctx.db()?
        .call_mut(move |db| {
            let transaction = db.transaction()?;
            transaction.execute(
                "DELETE FROM github_pairs WHERE project_id = ?",
                [&project_id],
            )?;
            prune_runs_in(&transaction, &project_id, 0)?;
            transaction.execute(
                "DELETE FROM github_links WHERE project_id = ?",
                [&project_id],
            )?;
            transaction.commit()?;
            Ok(())
        })
        .await
}
