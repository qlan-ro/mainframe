//! Reads the local task row and decides whether a dispute is even possible
//! before spending an extra GitHub call: `issue_field_times` only matters when
//! both sides moved a dated field since the baseline.

use crate::context::PluginContext;
use crate::github_port::{IssueFieldTimes, IssueSnapshot, IssueState, RepoRef};
use crate::todos::repo;
use crate::todos::types::{Todo, TodoStatus};
use crate::todos_github::reconcile::{self, Baseline, Reconciliation, project_status};
use crate::todos_github::{store, touch};

use super::{StopReason, handle_port_error};

/// Whether both sides moved the title, or the state, since the baseline —
/// the only disputes the per-field timeline can settle.
fn needs_field_times(local: &Todo, baseline: &Baseline, issue: &IssueSnapshot) -> bool {
    let issue_state = issue_state(issue);
    let title_dispute = local.title != baseline.title && issue.title != baseline.title;
    let in_progress_close = local.status == TodoStatus::InProgress && issue_state == "closed";
    let state_dispute = !in_progress_close
        && project_status(local.status.as_str()) != baseline.state
        && issue_state != baseline.state;
    title_dispute || state_dispute
}

fn issue_state(issue: &IssueSnapshot) -> &'static str {
    match issue.state {
        IssueState::Open => "open",
        IssueState::Closed => "closed",
    }
}

/// The read-and-reconcile half of a pair's sync: fetches the local row, the
/// issue, and (only when a dispute is possible) the issue's field times, then
/// runs the pure `reconcile` step. `Ok(None)` covers both "nothing to do"
/// (the todo is gone) and a per-pair port error already recorded by
/// `handle_port_error`; an `Err` is a stop-worthy failure for the whole run.
pub(super) async fn plan_pair(
    ctx: &PluginContext,
    repo: &RepoRef,
    credential_label: &str,
    pair: &store::Pair,
) -> Result<Option<(Todo, Reconciliation)>, StopReason> {
    let Some(local) = repo::fetch(ctx, &pair.todo_id).await? else {
        return Ok(None);
    };
    let issue_number = pair.issue_number.unsigned_abs();

    let issue = match ctx
        .github
        .get_issue(repo, issue_number, credential_label)
        .await
    {
        Ok(issue) => issue,
        Err(err) => return handle_port_error(ctx, pair, err).await.map(|_| None),
    };

    let baseline = Baseline {
        title: pair.base_title.clone(),
        body: pair.base_body.clone(),
        state: pair.base_state.clone(),
        labels: pair.base_labels.clone(),
    };

    let field_times = if needs_field_times(&local, &baseline, &issue) {
        match ctx
            .github
            .issue_field_times(repo, issue_number, credential_label)
            .await
        {
            Ok(times) => times,
            Err(err) => return handle_port_error(ctx, pair, err).await.map(|_| None),
        }
    } else {
        IssueFieldTimes::default()
    };

    let todo_id = pair.todo_id.clone();
    let touched = ctx
        .db()?
        .call(move |db| Ok(touch::touch_times(db, &todo_id)?))
        .await?;

    let plan = reconcile::reconcile(
        &reconcile::LocalTask {
            title: local.title.clone(),
            body: local.body.clone(),
            status: local.status.as_str().to_string(),
            labels: local.labels.clone(),
        },
        &remote_view(issue, field_times),
        &baseline,
        &touched,
    );

    Ok(Some((local, plan)))
}

fn remote_view(issue: IssueSnapshot, field_times: IssueFieldTimes) -> reconcile::RemoteIssueView {
    reconcile::RemoteIssueView {
        state: issue_state(&issue).to_string(),
        title: issue.title,
        body: issue.body,
        labels: issue.labels,
        updated_at: issue.updated_at,
        title_at: field_times.title_at,
        state_at: field_times.state_at,
    }
}
