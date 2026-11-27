//! The sync-run driver: the only place in `todos_github` that calls the
//! `GitHubIssues` port. Reads the link, reconciles every eligible pair
//! through the pure `reconcile` module, and persists both the writes and the
//! run's report. One run per project at a time.

mod apply;
mod fetch;

use std::sync::LazyLock;

use dashmap::DashMap;
use dashmap::mapref::entry::Entry;
use mainframe_types::time::now_iso8601;

use crate::PluginError;
use crate::context::PluginContext;
use crate::github_port::{GitHubPortError, RepoRef};
use crate::todos_github::store::{self, PairState};
use fetch::plan_pair;

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

/// Why a run stopped before reaching every pair; stored as the run's
/// `failure_kind` and `failure_message`.
#[derive(Debug)]
pub(super) struct StopReason {
    kind: &'static str,
    message: String,
}

impl StopReason {
    fn new(kind: &'static str, message: impl ToString) -> Self {
        Self {
            kind,
            message: message.to_string(),
        }
    }
}

impl From<PluginError> for StopReason {
    fn from(err: PluginError) -> Self {
        Self::new("internal", err)
    }
}

/// Projects with a run in flight. A second `run_sync` for one of them is
/// refused rather than queued.
static RUNNING: LazyLock<DashMap<String, ()>> = LazyLock::new(DashMap::new);

/// Holds a project's entry in [`RUNNING`] and releases it on drop, so a run
/// whose request is cancelled mid-flight does not lock the project out.
struct RunSlot(String);

impl RunSlot {
    fn acquire(project_id: &str) -> Option<Self> {
        match RUNNING.entry(project_id.to_string()) {
            Entry::Occupied(_) => None,
            Entry::Vacant(slot) => {
                slot.insert(());
                Some(Self(project_id.to_string()))
            }
        }
    }
}

impl Drop for RunSlot {
    fn drop(&mut self) {
        RUNNING.remove(&self.0);
    }
}

pub(crate) async fn run_sync(
    ctx: &PluginContext,
    project_id: &str,
) -> Result<store::Run, RunError> {
    let Some(_slot) = RunSlot::acquire(project_id) else {
        return Err(RunError::AlreadyRunning);
    };
    run_sync_inner(ctx, project_id).await
}

/// Whether a run is in flight for the project (`GET /link`'s `running`).
pub fn is_running(project_id: &str) -> bool {
    RUNNING.contains_key(project_id)
}

async fn run_sync_inner(ctx: &PluginContext, project_id: &str) -> Result<store::Run, RunError> {
    let link = store::read_link(ctx, project_id)
        .await?
        .ok_or(RunError::NotLinked)?;
    let pairs = store::pairs_for_project(ctx, project_id).await?;
    let scope = RunScope {
        ctx,
        repo: RepoRef {
            owner: link.owner,
            repo: link.repo,
        },
        credential_label: link.credential_label,
        run_id: nanoid::nanoid!(),
    };
    let started_at = now_iso8601();
    let total = pairs.len() as i64;
    let mut reached = 0i64;
    let mut pairs_reconciled = 0i64;
    let mut report_rows = Vec::new();
    let mut stop: Option<StopReason> = None;

    for pair in &pairs {
        reached += 1;
        match reconcile_pair(&scope, pair, &mut report_rows).await {
            Ok(true) => pairs_reconciled += 1,
            Ok(false) => {}
            Err(reason) => {
                stop = Some(reason);
                break;
            }
        }
    }

    let run = store::Run {
        id: scope.run_id,
        project_id: project_id.to_string(),
        started_at,
        finished_at: now_iso8601(),
        pairs_reconciled,
        reached,
        total,
        failure_kind: stop.as_ref().map(|reason| reason.kind.to_string()),
        failure_message: stop.map(|reason| reason.message),
    };
    store::finish_run(ctx, &run, &report_rows, KEEP_RUNS).await?;
    Ok(run)
}

/// What every pair of one run shares.
struct RunScope<'a> {
    ctx: &'a PluginContext,
    repo: RepoRef,
    credential_label: String,
    run_id: String,
}

/// One pair's reconcile-and-apply. `Ok(true)` reconciled cleanly, `Ok(false)`
/// was skipped (already unlinked, or newly marked errored/remotely-unlinked),
/// `Err` stops the whole run.
async fn reconcile_pair(
    scope: &RunScope<'_>,
    pair: &store::Pair,
    report_rows: &mut Vec<store::ReportRow>,
) -> Result<bool, StopReason> {
    let RunScope {
        ctx,
        repo,
        credential_label,
        run_id,
    } = scope;
    let Some((local, plan)) = plan_pair(ctx, repo, credential_label, pair).await? else {
        return Ok(false);
    };

    if let Some(patch) = apply::build_issue_patch(&plan.remote_writes)
        && let Err(err) = ctx
            .github
            .update_issue(
                repo,
                pair.issue_number.unsigned_abs(),
                patch,
                credential_label,
            )
            .await
    {
        return handle_port_error(ctx, pair, err).await;
    }

    apply::persist_pair(ctx, &pair.todo_id, &plan, &now_iso8601()).await?;

    report_rows.extend(plan.report_rows.into_iter().map(|row| store::ReportRow {
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
    }));
    Ok(true)
}

/// `NotFound`/`Moved`, `Request` and `UnexpectedResponse` are per-pair
/// failures the run survives; everything else (auth, rate limiting, network,
/// capability unavailable) stops the run so unreached pairs and
/// already-written baselines stay put.
async fn handle_port_error(
    ctx: &PluginContext,
    pair: &store::Pair,
    err: GitHubPortError,
) -> Result<bool, StopReason> {
    let state = match err {
        GitHubPortError::NotFound | GitHubPortError::Moved => PairState::RemotelyUnlinked,
        GitHubPortError::Request { .. } | GitHubPortError::UnexpectedResponse(_) => {
            PairState::Errored
        }
        GitHubPortError::Auth(_) => return Err(StopReason::new("auth", err)),
        GitHubPortError::RateLimited { .. } => return Err(StopReason::new("rate_limited", err)),
        GitHubPortError::Network(_) => return Err(StopReason::new("network", err)),
        GitHubPortError::Unavailable(_) => return Err(StopReason::new("unavailable", err)),
    };
    store::set_pair_state(ctx, &pair.todo_id, state, Some(&err.to_string())).await?;
    Ok(false)
}
