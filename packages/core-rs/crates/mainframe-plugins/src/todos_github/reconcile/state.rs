//! State reconciliation: the board's three-value status projects onto
//! GitHub's open/closed before any comparison runs, and baselines only ever
//! store that projection (spec "State").

use super::fields::decide_winner;
use super::{Baseline, LocalTask, RemoteIssueView, ReportRowDraft, TouchTimes};

pub(super) struct StateOutcome {
    pub local_status: Option<String>,
    pub remote_state: Option<String>,
    pub next_state: String,
    pub report_row: Option<ReportRowDraft>,
}

pub(super) fn reconcile_state(
    local: &LocalTask,
    remote: &RemoteIssueView,
    baseline: &Baseline,
    touch: &TouchTimes,
) -> StateOutcome {
    let local_projected = project(&local.status);
    let local_changed = local_projected != baseline.state;
    let remote_changed = remote.state != baseline.state;

    match (local_changed, remote_changed) {
        (false, false) => StateOutcome {
            local_status: None,
            remote_state: None,
            next_state: baseline.state.clone(),
            report_row: None,
        },
        (true, false) => StateOutcome {
            local_status: None,
            remote_state: Some(local_projected.to_string()),
            next_state: local_projected.to_string(),
            report_row: None,
        },
        // Only remote moved. Ordinarily that's a silent one-sided propagation
        // (AC10) — but a close landing on an `in_progress` task discards
        // information GitHub never modeled, so it's always reported even
        // though neither clock resolves it (rule `in-progress-close`).
        (false, true) if local.status == "in_progress" && remote.state == "closed" => {
            StateOutcome {
                local_status: Some("done".to_string()),
                remote_state: None,
                next_state: remote.state.clone(),
                report_row: Some(ReportRowDraft {
                    field: "state",
                    winner: "github",
                    rule: "in-progress-close",
                    local_at: None,
                    remote_at: None,
                    remote_coarse: false,
                    winning_value: remote.state.clone(),
                    replaced_value: local.status.clone(),
                }),
            }
        }
        (false, true) => StateOutcome {
            local_status: Some(mapped_from_remote(&remote.state).to_string()),
            remote_state: None,
            next_state: remote.state.clone(),
            report_row: None,
        },
        // Both sides moved off the baseline, but the open/closed set has only
        // two members: if they landed on the same value there's no dispute to
        // resolve, and picking a "winner" would fabricate a report row and
        // fire a redundant write at the "loser".
        (true, true) if local_projected == remote.state => StateOutcome {
            local_status: None,
            remote_state: None,
            next_state: remote.state.clone(),
            report_row: None,
        },
        (true, true) => resolve_dispute(local, remote, touch),
    }
}

fn resolve_dispute(
    local: &LocalTask,
    remote: &RemoteIssueView,
    touch: &TouchTimes,
) -> StateOutcome {
    let local_at = touch.state_at.as_deref();
    let remote_at = remote.state_at.as_deref();
    let (local_wins, rule) = decide_winner(local_at, remote_at);
    let local_projected = project(&local.status);

    if local_wins {
        StateOutcome {
            local_status: None,
            remote_state: Some(local_projected.to_string()),
            next_state: local_projected.to_string(),
            report_row: Some(ReportRowDraft {
                field: "state",
                winner: "local",
                rule,
                local_at: local_at.map(str::to_string),
                remote_at: remote_at.map(str::to_string),
                remote_coarse: false,
                winning_value: local.status.clone(),
                replaced_value: remote.state.clone(),
            }),
        }
    } else {
        StateOutcome {
            local_status: Some(mapped_from_remote(&remote.state).to_string()),
            remote_state: None,
            next_state: remote.state.clone(),
            report_row: Some(ReportRowDraft {
                field: "state",
                winner: "github",
                rule,
                local_at: local_at.map(str::to_string),
                remote_at: remote_at.map(str::to_string),
                remote_coarse: false,
                winning_value: remote.state.clone(),
                replaced_value: local.status.clone(),
            }),
        }
    }
}

fn project(status: &str) -> &'static str {
    if status == "done" { "closed" } else { "open" }
}

fn mapped_from_remote(state: &str) -> &'static str {
    if state == "closed" { "done" } else { "open" }
}
