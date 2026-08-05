use crate::todos_github::reconcile::{TouchTimes, reconcile};

use super::{baseline, find_row, local, remote};

#[test]
fn in_progress_task_closed_remotely_reports_the_special_rule() {
    let local = local("t", "b", "in_progress", &[]);
    let remote = remote("t", "b", "closed", &[], "2026-07-31T00:00:00Z");
    let baseline = baseline("t", "b", "open", &[]);

    let plan = reconcile(&local, &remote, &baseline, &TouchTimes::default());

    let row = find_row(&plan.report_rows, "state").unwrap();
    assert_eq!(row.rule, "in-progress-close");
    assert_eq!(row.local_at, None);
    assert_eq!(row.remote_at, None);
    assert_eq!(plan.local_writes.status.as_deref(), Some("done"));
}

#[test]
fn in_progress_task_with_no_remote_change_writes_nothing() {
    let local = local("t", "b", "in_progress", &[]);
    let remote = remote("t", "b", "open", &[], "2026-07-31T00:00:00Z");
    let baseline = baseline("t", "b", "open", &[]);

    let plan = reconcile(&local, &remote, &baseline, &TouchTimes::default());

    assert_eq!(plan.local_writes, Default::default());
    assert_eq!(plan.remote_writes, Default::default());
    assert!(plan.report_rows.is_empty());
}

#[test]
fn both_sides_move_state_to_the_same_value_is_not_a_dispute() {
    // Local marks the task done (projects to closed) and GitHub is closed
    // independently — both sides agree, so this must not be reported as an
    // overwrite, and it must not downgrade a genuine in_progress→open tie.
    let local = local("t", "b", "done", &[]);
    let remote = remote("t", "b", "closed", &[], "2026-07-31T00:00:00Z");
    let baseline = baseline("t", "b", "open", &[]);

    let plan = reconcile(&local, &remote, &baseline, &TouchTimes::default());

    assert_eq!(plan.local_writes, Default::default());
    assert_eq!(plan.remote_writes, Default::default());
    assert!(plan.report_rows.is_empty());
    assert_eq!(plan.next_baseline.state, "closed");
}

#[test]
fn both_sides_move_state_to_open_preserves_in_progress() {
    // Baseline closed; local reopens to in_progress (projects open) and
    // GitHub is independently reopened. The projections agree, so nothing
    // should overwrite the richer local `in_progress` status.
    let local = local("t", "b", "in_progress", &[]);
    let remote = remote("t", "b", "open", &[], "2026-07-31T00:00:00Z");
    let baseline = baseline("t", "b", "closed", &[]);

    let plan = reconcile(&local, &remote, &baseline, &TouchTimes::default());

    assert_eq!(plan.local_writes, Default::default());
    assert_eq!(plan.remote_writes, Default::default());
    assert!(plan.report_rows.is_empty());
    assert_eq!(plan.next_baseline.state, "open");
}
