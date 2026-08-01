use crate::todos_github::reconcile::{TouchTimes, reconcile};

use super::{baseline, local, remote};

#[test]
fn labels_added_locally_survive() {
    let local = local("t", "b", "open", &["feature"]);
    let remote = remote("t", "b", "open", &[], "2026-07-31T00:00:00Z");
    let baseline = baseline("t", "b", "open", &[]);

    let plan = reconcile(&local, &remote, &baseline, &TouchTimes::default());

    assert_eq!(plan.next_baseline.labels, vec!["feature".to_string()]);
    assert_eq!(plan.remote_writes.labels, Some(vec!["feature".to_string()]));
    assert!(
        plan.report_rows.is_empty(),
        "labels never produce a report row"
    );
}

#[test]
fn labels_removed_remotely_are_removed_locally() {
    let local = local("t", "b", "open", &["feature"]);
    let remote = remote("t", "b", "open", &[], "2026-07-31T00:00:00Z");
    let baseline = baseline("t", "b", "open", &["feature"]);

    let plan = reconcile(&local, &remote, &baseline, &TouchTimes::default());

    assert!(plan.next_baseline.labels.is_empty());
    assert_eq!(plan.local_writes.labels, Some(vec![]));
    assert!(plan.report_rows.is_empty());
}

#[test]
fn labels_removed_on_both_sides_stay_gone() {
    let local = local("t", "b", "open", &[]);
    let remote = remote("t", "b", "open", &[], "2026-07-31T00:00:00Z");
    let baseline = baseline("t", "b", "open", &["feature"]);

    let plan = reconcile(&local, &remote, &baseline, &TouchTimes::default());

    assert!(plan.next_baseline.labels.is_empty());
    assert_eq!(plan.local_writes, Default::default());
    assert_eq!(plan.remote_writes, Default::default());
}

#[test]
fn workflow_labels_never_cross_in_either_direction() {
    let local = local("t", "b", "open", &["needs-triage", "route:full"]);
    let remote = remote(
        "t",
        "b",
        "open",
        &["needs-triage", "route:full"],
        "2026-07-31T00:00:00Z",
    );
    let baseline = baseline("t", "b", "open", &[]);

    let plan = reconcile(&local, &remote, &baseline, &TouchTimes::default());

    assert_eq!(
        plan.local_writes.labels, None,
        "workflow labels are already local, nothing to write"
    );
    assert_eq!(
        plan.remote_writes.labels, None,
        "workflow labels never go outbound"
    );
    assert!(plan.next_baseline.labels.is_empty());
}

#[test]
fn labels_in_a_different_order_on_each_side_are_not_rewritten() {
    // GitHub and the merge algorithm order labels independently — a linked
    // pair with 2+ syncable labels must not PATCH forever just because the
    // arrays aren't in the same sequence.
    let local = local("t", "b", "open", &["alpha", "beta"]);
    let remote = remote("t", "b", "open", &["beta", "alpha"], "2026-07-31T00:00:00Z");
    let baseline = baseline("t", "b", "open", &["alpha", "beta"]);

    let plan = reconcile(&local, &remote, &baseline, &TouchTimes::default());

    assert_eq!(plan.local_writes.labels, None);
    assert_eq!(plan.remote_writes.labels, None);
}
