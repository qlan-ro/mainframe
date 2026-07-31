//! Pure GitHub sync reconciliation (todo #286): a 3-way comparison of the
//! local task, the remote issue, and the stored baseline decides what
//! changed — never a clock alone (spec "What a sync run does"). No I/O here;
//! `run.rs` is the only caller and owns every side effect this plan names.

mod fields;
mod labels;
mod state;

/// The local task's synced fields, read fresh for this run. `status` is the
/// real three-value board status — `state.rs` needs it verbatim to detect the
/// `in_progress` special case (spec "State"), not just its open/closed
/// projection.
#[derive(Debug, Clone, PartialEq)]
pub struct LocalTask {
    pub title: String,
    pub body: String,
    pub status: String,
    pub labels: Vec<String>,
}

/// The remote issue's synced fields, read fresh for this run. `title_at` and
/// `state_at` are the dated per-field events (`None` when the timeline can't
/// resolve one); `updated_at` is the issue's own coarse modification time,
/// the only stamp a body dispute can use (spec "What 'more recent' means").
#[derive(Debug, Clone, PartialEq)]
pub struct RemoteIssueView {
    pub title: String,
    pub body: String,
    pub state: String,
    pub labels: Vec<String>,
    pub updated_at: String,
    pub title_at: Option<String>,
    pub state_at: Option<String>,
}

/// The values both sides agreed on as of the last reconciliation (or pair
/// creation). `state` and `labels` are already projected/filtered — see
/// `store::Pair::base_state`/`base_labels`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Baseline {
    pub title: String,
    pub body: String,
    pub state: String,
    pub labels: Vec<String>,
}

/// The per-field-family local-recency clock (D3) — never the task row's
/// general `updated_at`. Absent entries compare as unresolved, same as a
/// remote stamp that can't be read.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TouchTimes {
    pub title_at: Option<String>,
    pub body_at: Option<String>,
    pub state_at: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct LocalWrites {
    pub title: Option<String>,
    pub body: Option<String>,
    pub status: Option<String>,
    pub labels: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct RemoteWrites {
    pub title: Option<String>,
    pub body: Option<String>,
    pub state: Option<String>,
    pub labels: Option<Vec<String>>,
}

/// Everything a reconciled overwrite needs for `github_report_rows`, minus
/// the identifying columns (`todo_id`, `todo_number`, `issue_number`, …) only
/// `run.rs` has in hand.
#[derive(Debug, Clone, PartialEq)]
pub struct ReportRowDraft {
    pub field: &'static str,
    pub winner: &'static str,
    pub rule: &'static str,
    pub local_at: Option<String>,
    pub remote_at: Option<String>,
    pub remote_coarse: bool,
    pub winning_value: String,
    pub replaced_value: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Reconciliation {
    pub local_writes: LocalWrites,
    pub remote_writes: RemoteWrites,
    pub report_rows: Vec<ReportRowDraft>,
    pub next_baseline: Baseline,
}

/// The single entry point every reconciliation goes through: title and body
/// as independent scalar disputes, state on its open/closed projection, and
/// labels as a per-item 3-way merge that never produces a report row.
pub fn reconcile(
    local: &LocalTask,
    remote: &RemoteIssueView,
    baseline: &Baseline,
    touch: &TouchTimes,
) -> Reconciliation {
    let mut local_writes = LocalWrites::default();
    let mut remote_writes = RemoteWrites::default();
    let mut report_rows = Vec::new();

    let title = fields::reconcile_scalar(fields::ScalarInput {
        field: "title",
        local_value: &local.title,
        remote_value: &remote.title,
        baseline_value: &baseline.title,
        local_at: touch.title_at.as_deref(),
        remote_at: remote.title_at.as_deref(),
        remote_coarse: false,
    });
    fields::apply(
        title.clone(),
        &mut local_writes.title,
        &mut remote_writes.title,
        &mut report_rows,
    );

    let body = fields::reconcile_scalar(fields::ScalarInput {
        field: "body",
        local_value: &local.body,
        remote_value: &remote.body,
        baseline_value: &baseline.body,
        local_at: touch.body_at.as_deref(),
        remote_at: Some(&remote.updated_at),
        remote_coarse: true,
    });
    fields::apply(
        body.clone(),
        &mut local_writes.body,
        &mut remote_writes.body,
        &mut report_rows,
    );

    let state_outcome = state::reconcile_state(local, remote, baseline, touch);
    local_writes.status = state_outcome.local_status;
    remote_writes.state = state_outcome.remote_state;
    if let Some(row) = state_outcome.report_row {
        report_rows.push(row);
    }

    let label_outcome = labels::reconcile_labels(&local.labels, &remote.labels, &baseline.labels);
    local_writes.labels = label_outcome.local_labels;
    remote_writes.labels = label_outcome.remote_labels;

    Reconciliation {
        local_writes,
        remote_writes,
        report_rows,
        next_baseline: Baseline {
            title: title.next_value,
            body: body.next_value,
            state: state_outcome.next_state,
            labels: label_outcome.next_labels,
        },
    }
}
