//! Writes a reconciliation's two output halves: the local side goes straight
//! to the `todos` table (never through the touch map, so an inbound sync
//! write never reads as a fresh local edit — D3/AC15) and the remote side
//! becomes a single `IssuePatch`.

use rusqlite::Connection;
use rusqlite::types::Value as SqlValue;

use crate::PluginError;
use crate::context::PluginContext;
use crate::github_port::{IssuePatch, IssueState};
use crate::todos_github::reconcile::{LocalWrites, Reconciliation, RemoteWrites};
use crate::todos_github::store::{self, PairState};

/// Advances `updated_at` whenever anything is written, even a labels-only
/// change, but never stamps the touch map — that would make this run's own
/// inbound write look like a local edit on the next run.
fn apply_local_writes(
    db: &Connection,
    todo_id: &str,
    writes: &LocalWrites,
    now: &str,
) -> Result<(), PluginError> {
    let mut sets = vec!["updated_at = ?"];
    let mut values = vec![SqlValue::Text(now.to_string())];
    let mut set = |column: &'static str, value: String| {
        sets.push(column);
        values.push(SqlValue::Text(value));
    };
    if let Some(title) = &writes.title {
        set("title = ?", title.clone());
    }
    if let Some(body) = &writes.body {
        set("body = ?", body.clone());
    }
    if let Some(status) = &writes.status {
        set("status = ?", status.clone());
    }
    if let Some(labels) = &writes.labels {
        set("labels = ?", serde_json::to_string(labels)?);
    }
    if sets.len() == 1 {
        return Ok(());
    }
    values.push(SqlValue::Text(todo_id.to_string()));
    let sql = format!("UPDATE todos SET {} WHERE id = ?", sets.join(", "));
    db.execute(&sql, rusqlite::params_from_iter(values))?;
    Ok(())
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
        state: writes.state.as_ref().map(|_| {
            if closing {
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
/// resting state, in one transaction. The state reflects only the *last* run
/// (a clean run clears any earlier `errored`/`remotely-unlinked` mark).
pub(super) async fn persist_pair(
    ctx: &PluginContext,
    todo_id: &str,
    plan: &Reconciliation,
    now: &str,
) -> Result<(), PluginError> {
    let pair_state = if plan.report_rows.is_empty() {
        PairState::Clean
    } else {
        PairState::Overwritten
    };
    let todo_id = todo_id.to_string();
    let local_writes = plan.local_writes.clone();
    let baseline = plan.next_baseline.clone();
    let now = now.to_string();
    ctx.db()?
        .call_mut(move |db| {
            let transaction = db.transaction()?;
            apply_local_writes(&transaction, &todo_id, &local_writes, &now)?;
            store::write_baseline_in(&transaction, &todo_id, &baseline, &now)?;
            store::set_pair_state_in(&transaction, &todo_id, pair_state, None)?;
            transaction.commit()?;
            Ok(())
        })
        .await
}
