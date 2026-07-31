//! The sync-run driver (todo #286): the only place in `todos_github` that
//! calls the `GitHubIssues` port. Reads the link, reconciles every eligible
//! pair through the pure `reconcile` module, and persists both the writes and
//! the run's report. One run per project at a time (fact 12, AC35).

mod apply;
mod fetch;

use std::sync::LazyLock;

use dashmap::DashMap;
use mainframe_runtime::time::now_iso8601;

use crate::PluginError;
use crate::context::PluginContext;
use crate::github_port::{GitHubPortError, RepoRef};
use crate::todos_github::reconcile::{self, Baseline, RemoteIssueView, TouchTimes};
use crate::todos_github::{store, touch};
use fetch::{LocalRow, fetch_local, needs_field_times, project_issue_state};

const KEEP_RUNS: i64 = 10;

#[derive(Debug)]
pub enum RunError {
    AlreadyRunning,
    NotLinked,
    Failed(PluginError),
}

impl From<PluginError> for RunError {
    fn from(err: PluginError) -> Self {
        RunError::Failed(err)
    }
}

/// Per-project mutual exclusion: a second `run_sync` for a project already
/// running is refused rather than queued or blocked.
static RUNNING: LazyLock<DashMap<String, ()>> = LazyLock::new(DashMap::new);

pub async fn run_sync(ctx: &PluginContext, project_id: &str) -> Result<store::Run, RunError> {
    if RUNNING.insert(project_id.to_string(), ()).is_some() {
        return Err(RunError::AlreadyRunning);
    }
    let result = run_sync_inner(ctx, project_id).await;
    RUNNING.remove(project_id);
    result
}

/// Read access to the mutual-exclusion set for `GET /link`'s `running` field
/// (routes.rs, task 19) — the route surface has no other way to answer it.
pub fn is_running(project_id: &str) -> bool {
    RUNNING.contains_key(project_id)
}

async fn run_sync_inner(ctx: &PluginContext, project_id: &str) -> Result<store::Run, RunError> {
    let mut link = store::read_link(ctx, project_id)
        .await?
        .ok_or(RunError::NotLinked)?;
    let repo = RepoRef {
        owner: link.owner.clone(),
        repo: link.repo.clone(),
    };
    let pairs = store::pairs_for_project(ctx, project_id).await?;

    let run_id = nanoid::nanoid!();
    let started_at = now_iso8601();
    let total = pairs.len() as i64;
    let mut reached = 0i64;
    let mut pairs_reconciled = 0i64;
    let mut report_rows = Vec::new();
    let mut stop: Option<(&'static str, String)> = None;

    for pair in &pairs {
        reached += 1;
        match reconcile_pair(
            ctx,
            &repo,
            &link.credential_label,
            pair,
            &run_id,
            &mut report_rows,
        )
        .await
        {
            Ok(true) => pairs_reconciled += 1,
            Ok(false) => {}
            Err((kind, message)) => {
                stop = Some((kind, message));
                break;
            }
        }
    }

    let finished_at = now_iso8601();
    link.last_synced_at = Some(finished_at.clone());
    store::insert_link(ctx, &link).await?;

    let run = store::Run {
        id: run_id,
        project_id: project_id.to_string(),
        started_at,
        finished_at,
        pairs_reconciled,
        reached,
        total,
        failure_kind: stop.as_ref().map(|(kind, _)| kind.to_string()),
        failure_message: stop.as_ref().map(|(_, message)| message.clone()),
    };
    store::insert_run(ctx, &run).await?;
    store::insert_report_rows(ctx, &report_rows).await?;
    store::prune_runs(ctx, project_id, KEEP_RUNS).await?;
    Ok(run)
}

/// One pair's reconcile-and-apply. `Ok(true)` reconciled cleanly, `Ok(false)`
/// was skipped (already unlinked, or newly marked errored/remotely-unlinked),
/// `Err` carries a stop-worthy failure kind + message for the whole run.
async fn reconcile_pair(
    ctx: &PluginContext,
    repo: &RepoRef,
    credential_label: &str,
    pair: &store::Pair,
    run_id: &str,
    report_rows: &mut Vec<store::ReportRow>,
) -> Result<bool, (&'static str, String)> {
    let Some(local) = fetch_local(ctx, &pair.todo_id).await.map_err(internal)? else {
        return Ok(false);
    };

    let issue = match ctx
        .github
        .get_issue(repo, pair.issue_number as u64, credential_label)
        .await
    {
        Ok(issue) => issue,
        Err(err) => return handle_port_error(ctx, pair, err).await,
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
            .issue_field_times(repo, pair.issue_number as u64, credential_label)
            .await
        {
            Ok(times) => times,
            Err(err) => return handle_port_error(ctx, pair, err).await,
        }
    } else {
        Default::default()
    };

    let plan = reconcile::reconcile(
        &to_local_task(&local),
        &to_remote_view(&issue, field_times),
        &baseline,
        &to_touch_times(
            &touch::read_touch(ctx, &pair.todo_id)
                .await
                .map_err(internal)?,
        ),
    );

    if let Some(patch) = apply::build_issue_patch(&plan.remote_writes)
        && let Err(err) = ctx
            .github
            .update_issue(repo, pair.issue_number as u64, patch, credential_label)
            .await
    {
        return handle_port_error(ctx, pair, err).await;
    }

    let now = now_iso8601();
    apply::apply_local_writes(ctx, &pair.todo_id, &plan.local_writes, &now)
        .await
        .map_err(internal)?;
    store::write_baseline(
        ctx,
        &pair.todo_id,
        &plan.next_baseline.title,
        &plan.next_baseline.body,
        &plan.next_baseline.state,
        &plan.next_baseline.labels,
        &now,
    )
    .await
    .map_err(internal)?;

    // The state reflects the *last* run, not history: a clean run clears any
    // earlier `errored`/`remotely-unlinked` mark, and only a run that
    // actually replaced something on either side earns the amber glyph.
    let pair_state = if plan.report_rows.is_empty() {
        "clean"
    } else {
        "overwritten"
    };
    store::set_pair_state(ctx, &pair.todo_id, pair_state, None)
        .await
        .map_err(internal)?;

    for row in plan.report_rows {
        report_rows.push(store::ReportRow {
            id: nanoid::nanoid!(),
            run_id: run_id.to_string(),
            todo_id: pair.todo_id.clone(),
            todo_number: local.number,
            todo_title: local.title.clone(),
            issue_number: pair.issue_number,
            field: row.field.to_string(),
            winner: row.winner.to_string(),
            rule: row.rule.to_string(),
            local_at: row.local_at,
            remote_at: row.remote_at,
            remote_coarse: row.remote_coarse,
            winning_value: row.winning_value,
            replaced_value: row.replaced_value,
        });
    }
    Ok(true)
}

/// `NotFound`/`Moved` and `Request` are per-pair failures the run survives;
/// everything else (auth, rate limiting, network, capability unavailable)
/// stops the run so unreached pairs and already-written baselines stay put.
async fn handle_port_error(
    ctx: &PluginContext,
    pair: &store::Pair,
    err: GitHubPortError,
) -> Result<bool, (&'static str, String)> {
    match err {
        GitHubPortError::NotFound | GitHubPortError::Moved => {
            store::set_pair_state(
                ctx,
                &pair.todo_id,
                "remotely-unlinked",
                Some(&err.to_string()),
            )
            .await
            .map_err(internal)?;
            Ok(false)
        }
        GitHubPortError::Request { .. } => {
            store::set_pair_state(ctx, &pair.todo_id, "errored", Some(&err.to_string()))
                .await
                .map_err(internal)?;
            Ok(false)
        }
        GitHubPortError::Auth(_) => Err(("auth", err.to_string())),
        GitHubPortError::RateLimited { .. } => Err(("rate_limited", err.to_string())),
        GitHubPortError::Network(_) => Err(("network", err.to_string())),
        GitHubPortError::Unavailable(_) => Err(("unavailable", err.to_string())),
    }
}

fn internal(err: PluginError) -> (&'static str, String) {
    ("internal", err.to_string())
}

fn to_local_task(row: &LocalRow) -> reconcile::LocalTask {
    reconcile::LocalTask {
        title: row.title.clone(),
        body: row.body.clone(),
        status: row.status.clone(),
        labels: row.labels.clone(),
    }
}

fn to_remote_view(
    issue: &crate::github_port::IssueSnapshot,
    field_times: crate::github_port::IssueFieldTimes,
) -> RemoteIssueView {
    RemoteIssueView {
        title: issue.title.clone(),
        body: issue.body.clone(),
        state: project_issue_state(issue).to_string(),
        labels: issue.labels.clone(),
        updated_at: issue.updated_at.clone(),
        title_at: field_times.title_at,
        state_at: field_times.state_at,
    }
}

fn to_touch_times(touch: &std::collections::HashMap<String, String>) -> TouchTimes {
    TouchTimes {
        title_at: touch.get("title").cloned(),
        body_at: touch.get("body").cloned(),
        state_at: touch.get("state").cloned(),
    }
}
