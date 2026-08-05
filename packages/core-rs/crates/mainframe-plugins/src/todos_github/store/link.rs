//! `github_links` — one row per project, the repo it syncs against.

use crate::PluginError;
use crate::context::PluginContext;
use crate::db_context::{Row, nullable_text, text};

use super::{col_opt_str, col_str};

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

/// Upserts the single link row for `link.project_id`.
pub async fn insert_link(ctx: &PluginContext, link: &Link) -> Result<(), PluginError> {
    ctx.db
        .execute(
            "INSERT INTO github_links
               (project_id, owner, repo, remote_name, credential_label, last_synced_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(project_id) DO UPDATE SET
               owner = excluded.owner, repo = excluded.repo, remote_name = excluded.remote_name,
               credential_label = excluded.credential_label,
               last_synced_at = excluded.last_synced_at"
                .into(),
            vec![
                text(link.project_id.clone()),
                text(link.owner.clone()),
                text(link.repo.clone()),
                text(link.remote_name.clone()),
                text(link.credential_label.clone()),
                nullable_text(link.last_synced_at.clone()),
                text(link.created_at.clone()),
            ],
        )
        .await
}

pub async fn read_link(ctx: &PluginContext, project_id: &str) -> Result<Option<Link>, PluginError> {
    let row = ctx
        .db
        .query_one(
            "SELECT * FROM github_links WHERE project_id = ?".into(),
            vec![text(project_id.to_string())],
        )
        .await?;
    Ok(row.map(row_to_link))
}

pub async fn delete_link(ctx: &PluginContext, project_id: &str) -> Result<(), PluginError> {
    ctx.db
        .execute(
            "DELETE FROM github_links WHERE project_id = ?".into(),
            vec![text(project_id.to_string())],
        )
        .await
}

fn row_to_link(row: Row) -> Link {
    Link {
        project_id: col_str(&row, "project_id"),
        owner: col_str(&row, "owner"),
        repo: col_str(&row, "repo"),
        remote_name: col_str(&row, "remote_name"),
        credential_label: col_str(&row, "credential_label"),
        last_synced_at: col_opt_str(&row, "last_synced_at"),
        created_at: col_str(&row, "created_at"),
    }
}
