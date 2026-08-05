//! Pure reconciliation tests (todo #286): title/body dispute rules, label
//! merging, and state's `in_progress` special case, mirroring
//! `reconcile/{fields,labels,state}.rs`. Split by submodule to stay under
//! the 300-line file cap (finding #13); this module holds the shared
//! fixture builders.

mod fields;
mod labels;
mod state;

use crate::todos_github::reconcile::{Baseline, LocalTask, RemoteIssueView, ReportRowDraft};

fn local(title: &str, body: &str, status: &str, labels: &[&str]) -> LocalTask {
    LocalTask {
        title: title.to_string(),
        body: body.to_string(),
        status: status.to_string(),
        labels: labels.iter().map(|l| l.to_string()).collect(),
    }
}

fn remote(
    title: &str,
    body: &str,
    state: &str,
    labels: &[&str],
    updated_at: &str,
) -> RemoteIssueView {
    RemoteIssueView {
        title: title.to_string(),
        body: body.to_string(),
        state: state.to_string(),
        labels: labels.iter().map(|l| l.to_string()).collect(),
        updated_at: updated_at.to_string(),
        title_at: None,
        state_at: None,
    }
}

fn baseline(title: &str, body: &str, state: &str, labels: &[&str]) -> Baseline {
    Baseline {
        title: title.to_string(),
        body: body.to_string(),
        state: state.to_string(),
        labels: labels.iter().map(|l| l.to_string()).collect(),
    }
}

fn find_row<'a>(rows: &'a [ReportRowDraft], field: &str) -> Option<&'a ReportRowDraft> {
    rows.iter().find(|r| r.field == field)
}
