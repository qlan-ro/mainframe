//! Label reconciliation: a per-item 3-way merge that never produces a
//! report row (AC16/AC22) and never lets a workflow label cross the wire in
//! either direction (AC27), reusing the denylist in `todos_github::labels`.

use crate::todos_github::labels::{is_workflow_label, keep_workflow_labels, syncable_labels};

pub(super) struct LabelOutcome {
    pub local_labels: Option<Vec<String>>,
    pub remote_labels: Option<Vec<String>>,
    pub next_labels: Vec<String>,
}

pub(super) fn reconcile_labels(
    local: &[String],
    remote: &[String],
    baseline: &[String],
) -> LabelOutcome {
    let local_syncable = syncable_labels(local);
    let remote_syncable: Vec<String> = remote
        .iter()
        .filter(|l| !is_workflow_label(l))
        .cloned()
        .collect();

    // Classic 3-way set merge: a label baseline already knew about needs
    // both sides to still hold it; a label baseline never saw needs only one
    // side to have added it (AC16 — "added locally survives", "removed
    // remotely is removed locally", "removed on both stays gone").
    let mut merged = Vec::new();
    for label in baseline
        .iter()
        .chain(local_syncable.iter())
        .chain(remote_syncable.iter())
    {
        if merged.contains(label) {
            continue;
        }
        let in_baseline = baseline.contains(label);
        let in_local = local_syncable.contains(label);
        let in_remote = remote_syncable.contains(label);
        let kept = if in_baseline {
            in_local && in_remote
        } else {
            in_local || in_remote
        };
        if kept {
            merged.push(label.clone());
        }
    }

    let local_labels = keep_workflow_labels(local, &merged);
    let local_write = if same_label_set(&local_labels, local) {
        None
    } else {
        Some(local_labels)
    };
    let remote_write = if same_label_set(&merged, &remote_syncable) {
        None
    } else {
        Some(merged.clone())
    };

    LabelOutcome {
        local_labels: local_write,
        remote_labels: remote_write,
        next_labels: merged,
    }
}

/// GitHub returns an issue's labels in its own order regardless of what we
/// send, and the merge above rebuilds order from scratch — comparing as
/// ordered vectors would PATCH GitHub (and rewrite the local column) on
/// every run even when nothing actually changed.
fn same_label_set(a: &[String], b: &[String]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut a_sorted = a.to_vec();
    let mut b_sorted = b.to_vec();
    a_sorted.sort();
    b_sorted.sort();
    a_sorted == b_sorted
}
