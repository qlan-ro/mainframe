use crate::todos_github::reconcile::{TouchTimes, reconcile};

use super::{baseline, find_row, local, remote};

#[test]
fn one_sided_local_title_change_wins_regardless_of_timestamps() {
    let local = local("Changed", "body", "open", &[]);
    // The remote stamp looks newer, but remote never changed the title, so
    // recency is irrelevant here (AC10).
    let mut remote = remote("Original", "body", "open", &[], "2026-07-31T00:00:00Z");
    remote.title_at = Some("2099-01-01T00:00:00Z".to_string());
    let baseline = baseline("Original", "body", "open", &[]);
    let touch = TouchTimes {
        title_at: Some("2000-01-01T00:00:00Z".to_string()),
        ..Default::default()
    };

    let plan = reconcile(&local, &remote, &baseline, &touch);

    assert_eq!(plan.remote_writes.title.as_deref(), Some("Changed"));
    assert_eq!(plan.local_writes.title, None);
    assert!(find_row(&plan.report_rows, "title").is_none());
    assert_eq!(plan.next_baseline.title, "Changed");
}

#[test]
fn neither_side_changed_is_an_empty_plan_even_if_updated_at_advanced() {
    let local = local("Same", "Same body", "open", &[]);
    let remote = remote("Same", "Same body", "open", &[], "2026-07-31T09:00:00Z");
    let baseline = baseline("Same", "Same body", "open", &[]);
    let touch = TouchTimes::default();

    let plan = reconcile(&local, &remote, &baseline, &touch);

    assert_eq!(plan.local_writes, Default::default());
    assert_eq!(plan.remote_writes, Default::default());
    assert!(plan.report_rows.is_empty());
}

#[test]
fn both_changed_title_local_newer_wins() {
    let local = local("Local title", "body", "open", &[]);
    let mut remote = remote("Remote title", "body", "open", &[], "2026-07-31T00:00:00Z");
    remote.title_at = Some("2026-07-31T10:00:00Z".to_string());
    let baseline = baseline("Original", "body", "open", &[]);
    let touch = TouchTimes {
        title_at: Some("2026-07-31T11:00:00Z".to_string()),
        ..Default::default()
    };

    let plan = reconcile(&local, &remote, &baseline, &touch);

    let row = find_row(&plan.report_rows, "title").unwrap();
    assert_eq!(row.winner, "local");
    assert_eq!(row.rule, "recency");
    assert_eq!(plan.remote_writes.title.as_deref(), Some("Local title"));
    assert_eq!(plan.local_writes.title, None);
}

#[test]
fn both_changed_title_remote_newer_wins() {
    let local = local("Local title", "body", "open", &[]);
    let mut remote = remote("Remote title", "body", "open", &[], "2026-07-31T00:00:00Z");
    remote.title_at = Some("2026-07-31T11:00:00Z".to_string());
    let baseline = baseline("Original", "body", "open", &[]);
    let touch = TouchTimes {
        title_at: Some("2026-07-31T10:00:00Z".to_string()),
        ..Default::default()
    };

    let plan = reconcile(&local, &remote, &baseline, &touch);

    let row = find_row(&plan.report_rows, "title").unwrap();
    assert_eq!(row.winner, "github");
    assert_eq!(row.rule, "recency");
    assert_eq!(plan.local_writes.title.as_deref(), Some("Remote title"));
    assert_eq!(plan.remote_writes.title, None);
}

#[test]
fn both_changed_body_falls_back_to_the_issue_coarse_updated_at() {
    let local = local("title", "Local body", "open", &[]);
    let remote = remote("title", "Remote body", "open", &[], "2026-07-31T12:00:00Z");
    let baseline = baseline("title", "Original body", "open", &[]);
    let touch = TouchTimes {
        body_at: Some("2026-07-31T10:00:00Z".to_string()),
        ..Default::default()
    };

    let plan = reconcile(&local, &remote, &baseline, &touch);

    let row = find_row(&plan.report_rows, "body").unwrap();
    assert_eq!(row.winner, "github");
    assert!(
        row.remote_coarse,
        "body has no dated event, only the coarse stamp"
    );
    assert_eq!(row.remote_at.as_deref(), Some("2026-07-31T12:00:00Z"));
}

#[test]
fn equal_to_the_second_stamps_tie_to_github() {
    let local = local("Local title", "body", "open", &[]);
    let mut remote = remote("Remote title", "body", "open", &[], "2026-07-31T00:00:00Z");
    remote.title_at = Some("2026-07-31T10:00:00.900Z".to_string());
    let baseline = baseline("Original", "body", "open", &[]);
    let touch = TouchTimes {
        title_at: Some("2026-07-31T10:00:00.100Z".to_string()),
        ..Default::default()
    };

    let plan = reconcile(&local, &remote, &baseline, &touch);

    let row = find_row(&plan.report_rows, "title").unwrap();
    assert_eq!(row.winner, "github");
    assert_eq!(row.rule, "tie");
}

#[test]
fn unresolvable_remote_stamp_ties_to_github_with_no_remote_at() {
    let local = local("Local title", "body", "open", &[]);
    let remote = remote("Remote title", "body", "open", &[], "2026-07-31T00:00:00Z");
    let baseline = baseline("Original", "body", "open", &[]);
    let touch = TouchTimes {
        title_at: Some("2026-07-31T10:00:00Z".to_string()),
        ..Default::default()
    };

    let plan = reconcile(&local, &remote, &baseline, &touch);

    let row = find_row(&plan.report_rows, "title").unwrap();
    assert_eq!(row.winner, "github");
    assert_eq!(row.rule, "tie");
    assert_eq!(row.remote_at, None);
}

#[test]
fn both_sides_edit_title_to_the_identical_value_is_not_a_dispute() {
    let local = local("Same new title", "body", "open", &[]);
    let mut remote = remote(
        "Same new title",
        "body",
        "open",
        &[],
        "2026-07-31T00:00:00Z",
    );
    remote.title_at = Some("2026-07-31T10:00:00Z".to_string());
    let baseline = baseline("Original", "body", "open", &[]);
    let touch = TouchTimes {
        title_at: Some("2026-07-31T11:00:00Z".to_string()),
        ..Default::default()
    };

    let plan = reconcile(&local, &remote, &baseline, &touch);

    assert_eq!(plan.local_writes.title, None);
    assert_eq!(plan.remote_writes.title, None);
    assert!(find_row(&plan.report_rows, "title").is_none());
    assert_eq!(plan.next_baseline.title, "Same new title");
}

#[test]
fn applying_an_inbound_change_yields_an_empty_second_reconcile() {
    let local_before = local("Original", "body", "open", &[]);
    let remote = remote("Remote wins", "body", "open", &[], "2026-07-31T00:00:00Z");
    let baseline = baseline("Original", "body", "open", &[]);

    let first = reconcile(&local_before, &remote, &baseline, &TouchTimes::default());
    assert_eq!(first.local_writes.title.as_deref(), Some("Remote wins"));

    // Apply the inbound write and reconcile again against the new baseline —
    // nothing should be outstanding (AC15).
    let local_after = local("Remote wins", "body", "open", &[]);
    let second = reconcile(
        &local_after,
        &remote,
        &first.next_baseline,
        &TouchTimes::default(),
    );

    assert_eq!(second.local_writes, Default::default());
    assert_eq!(second.remote_writes, Default::default());
    assert!(second.report_rows.is_empty());
}
