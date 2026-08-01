//! Writes a reconciliation's two output halves: the local side goes straight
//! to the `todos` table (never through `touch::stamp_patch`, so an inbound
//! sync write never reads as a fresh local edit — D3/AC15) and the remote
//! side becomes a single `IssuePatch`.

use crate::PluginError;
use crate::context::PluginContext;
use crate::db_context::text;
use crate::github_port::{IssuePatch, IssueState};
use crate::todos_github::reconcile::{LocalWrites, Reconciliation, RemoteWrites};
use crate::todos_github::store;

/// Advances `updated_at` whenever anything is written, even a labels-only
/// change, but never stamps the touch map — that would make this run's own
/// inbound write look like a local edit on the next run.
pub(super) async fn apply_local_writes(
    ctx: &PluginContext,
    todo_id: &str,
    writes: &LocalWrites,
    now: &str,
) -> Result<(), PluginError> {
    if writes.title.is_none()
        && writes.body.is_none()
        && writes.status.is_none()
        && writes.labels.is_none()
    {
        return Ok(());
    }

    let mut sets = vec!["updated_at = ?".to_string()];
    let mut vals = vec![text(now.to_string())];
    if let Some(title) = &writes.title {
        sets.push("title = ?".to_string());
        vals.push(text(title.clone()));
    }
    if let Some(body) = &writes.body {
        sets.push("body = ?".to_string());
        vals.push(text(body.clone()));
    }
    if let Some(status) = &writes.status {
        sets.push("status = ?".to_string());
        vals.push(text(status.clone()));
    }
    if let Some(labels) = &writes.labels {
        sets.push("labels = ?".to_string());
        vals.push(text(serde_json::to_string(labels)?));
    }
    vals.push(text(todo_id.to_string()));

    let sql = format!("UPDATE todos SET {} WHERE id = ?", sets.join(", "));
    ctx.db.execute(sql, vals).await
}

/// `None` when the reconcile plan asked for no outbound write at all, so the
/// caller can skip the GitHub call entirely.
pub(super) fn build_issue_patch(writes: &RemoteWrites) -> Option<IssuePatch> {
    if writes.title.is_none()
        && writes.body.is_none()
        && writes.state.is_none()
        && writes.labels.is_none()
    {
        return None;
    }
    let closing = writes.state.as_deref() == Some("closed");
    Some(IssuePatch {
        title: writes.title.clone(),
        body: writes.body.clone(),
        labels: writes.labels.clone(),
        state: writes.state.as_deref().map(|s| {
            if s == "closed" {
                IssueState::Closed
            } else {
                IssueState::Open
            }
        }),
        state_reason: closing.then(|| "completed".to_string()),
    })
}

/// The write half of a pair's sync, run after any outbound GitHub PATCH has
/// already succeeded: the local writes, the new baseline, and the pair's
/// resting state, which reflects only the *last* run (a clean run clears any
/// earlier `errored`/`remotely-unlinked` mark).
pub(super) async fn persist_pair(
    ctx: &PluginContext,
    pair: &store::Pair,
    plan: &Reconciliation,
    now: &str,
) -> Result<(), PluginError> {
    apply_local_writes(ctx, &pair.todo_id, &plan.local_writes, now).await?;
    store::write_baseline(
        ctx,
        &pair.todo_id,
        &plan.next_baseline.title,
        &plan.next_baseline.body,
        &plan.next_baseline.state,
        &plan.next_baseline.labels,
        now,
    )
    .await?;

    let pair_state = if plan.report_rows.is_empty() {
        "clean"
    } else {
        "overwritten"
    };
    store::set_pair_state(ctx, &pair.todo_id, pair_state, None).await
}
