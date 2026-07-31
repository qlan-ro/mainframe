//! Scalar (title/body) reconciliation: each field runs its own independent
//! 3-way diff, so title and body can pick different winners from the same
//! pair (spec "What a sync run does").

use super::ReportRowDraft;

pub(super) struct ScalarInput<'a> {
    pub field: &'static str,
    pub local_value: &'a str,
    pub remote_value: &'a str,
    pub baseline_value: &'a str,
    pub local_at: Option<&'a str>,
    pub remote_at: Option<&'a str>,
    pub remote_coarse: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub(super) struct ScalarOutcome {
    pub next_value: String,
    local_write: Option<String>,
    remote_write: Option<String>,
    report_row: Option<ReportRowDraft>,
}

/// Only a genuine dispute (both sides moved since the baseline) produces a
/// report row — a one-sided change simply propagates, so nothing was
/// overwritten (AC10, AC17).
pub(super) fn reconcile_scalar(input: ScalarInput<'_>) -> ScalarOutcome {
    let local_changed = input.local_value != input.baseline_value;
    let remote_changed = input.remote_value != input.baseline_value;

    match (local_changed, remote_changed) {
        (false, false) => ScalarOutcome {
            next_value: input.baseline_value.to_string(),
            local_write: None,
            remote_write: None,
            report_row: None,
        },
        (true, false) => ScalarOutcome {
            next_value: input.local_value.to_string(),
            local_write: None,
            remote_write: Some(input.local_value.to_string()),
            report_row: None,
        },
        (false, true) => ScalarOutcome {
            next_value: input.remote_value.to_string(),
            local_write: Some(input.remote_value.to_string()),
            remote_write: None,
            report_row: None,
        },
        // Both sides edited the field since the baseline, but if they landed
        // on the identical value there's nothing to resolve — a "winner"
        // here would fabricate a report row (winning == replaced) and issue
        // a redundant write to the other side.
        (true, true) if input.local_value == input.remote_value => ScalarOutcome {
            next_value: input.local_value.to_string(),
            local_write: None,
            remote_write: None,
            report_row: None,
        },
        (true, true) => resolve_dispute(input),
    }
}

fn resolve_dispute(input: ScalarInput<'_>) -> ScalarOutcome {
    let (local_wins, rule) = decide_winner(input.local_at, input.remote_at);

    let (winning_value, replaced_value, local_write, remote_write) = if local_wins {
        (
            input.local_value.to_string(),
            input.remote_value.to_string(),
            None,
            Some(input.local_value.to_string()),
        )
    } else {
        (
            input.remote_value.to_string(),
            input.local_value.to_string(),
            Some(input.remote_value.to_string()),
            None,
        )
    };

    ScalarOutcome {
        next_value: winning_value.clone(),
        local_write,
        remote_write,
        report_row: Some(ReportRowDraft {
            field: input.field,
            winner: if local_wins { "local" } else { "github" },
            rule,
            local_at: input.local_at.map(str::to_string),
            remote_at: input.remote_at.map(str::to_string),
            remote_coarse: input.remote_coarse,
            winning_value,
            replaced_value,
        }),
    }
}

/// Whole-second comparison; ties and an unresolvable remote stamp both
/// default to GitHub, per the plan's D-series tie-break rule. The wire enum
/// (plan line 179) only names three rules — `recency` covers both directions,
/// disambiguated by the report row's separate `winner` field.
pub(super) fn decide_winner(
    local_at: Option<&str>,
    remote_at: Option<&str>,
) -> (bool, &'static str) {
    match (local_at, remote_at) {
        (Some(l), Some(r)) => {
            let l = truncate_to_seconds(l);
            let r = truncate_to_seconds(r);
            if l > r {
                (true, "recency")
            } else if r > l {
                (false, "recency")
            } else {
                (false, "tie")
            }
        }
        _ => (false, "tie"),
    }
}

pub(super) fn apply(
    outcome: ScalarOutcome,
    local_write: &mut Option<String>,
    remote_write: &mut Option<String>,
    report_rows: &mut Vec<ReportRowDraft>,
) {
    *local_write = outcome.local_write;
    *remote_write = outcome.remote_write;
    if let Some(row) = outcome.report_row {
        report_rows.push(row);
    }
}

/// ISO8601 'Z'-suffixed UTC timestamps sort lexicographically the same as
/// chronologically, so dropping sub-second precision before comparing needs
/// no datetime library.
pub(crate) fn truncate_to_seconds(ts: &str) -> String {
    match ts.find('.') {
        Some(idx) => format!("{}Z", &ts[..idx]),
        None => ts.to_string(),
    }
}
