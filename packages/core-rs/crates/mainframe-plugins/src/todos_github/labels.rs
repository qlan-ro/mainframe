//! Workflow labels are Mainframe's own pipeline vocabulary (`route:*`, the
//! triage roles, …). Spec AC27/AC28: they never leave the daemon and are
//! never accepted back, so a run's outbound/inbound label sets always pass
//! through here first.

pub const WORKFLOW_LABEL_PREFIXES: [&str; 7] = [
    "route:",
    "gate:",
    "approved:",
    "rework:",
    "pipeline:",
    "pr:",
    "wayfinder:",
];

pub const WORKFLOW_LABELS: [&str; 7] = [
    "needs-triage",
    "needs-info",
    "ready-for-agent",
    "ready-for-human",
    "wontfix",
    "parked",
    "dispatched",
];

pub fn is_workflow_label(label: &str) -> bool {
    WORKFLOW_LABELS.contains(&label) || WORKFLOW_LABEL_PREFIXES.iter().any(|p| label.starts_with(p))
}

/// The outbound label set for a local task: every workflow label stripped.
pub fn syncable_labels(local: &[String]) -> Vec<String> {
    local
        .iter()
        .filter(|l| !is_workflow_label(l))
        .cloned()
        .collect()
}

/// The inbound merge for a local task's labels: the remote set (defensively
/// stripped of anything workflow-shaped) plus whichever workflow labels the
/// task already carries locally — remote never introduces one, and one
/// removed locally never resurfaces.
pub fn keep_workflow_labels(local: &[String], remote: &[String]) -> Vec<String> {
    let mut merged: Vec<String> = remote
        .iter()
        .filter(|l| !is_workflow_label(l))
        .cloned()
        .collect();
    for label in local {
        if is_workflow_label(label) && !merged.contains(label) {
            merged.push(label.clone());
        }
    }
    merged
}
