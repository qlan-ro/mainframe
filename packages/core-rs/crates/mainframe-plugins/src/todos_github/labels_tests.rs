use super::labels::{is_workflow_label, keep_workflow_labels, syncable_labels};

const PREFIXED: [&str; 7] = [
    "route:full",
    "gate:human",
    "approved:qa",
    "rework:v2",
    "pipeline:ci",
    "pr:draft",
    "wayfinder:on",
];

const EXACT: [&str; 7] = [
    "needs-triage",
    "needs-info",
    "ready-for-agent",
    "ready-for-human",
    "wontfix",
    "parked",
    "dispatched",
];

const ORDINARY: [&str; 3] = ["bug", "routes", "pr-review"];

#[test]
fn prefixed_labels_are_workflow_labels() {
    for label in PREFIXED {
        assert!(
            is_workflow_label(label),
            "{label} should be a workflow label"
        );
    }
}

#[test]
fn exact_labels_are_workflow_labels() {
    for label in EXACT {
        assert!(
            is_workflow_label(label),
            "{label} should be a workflow label"
        );
    }
}

#[test]
fn ordinary_labels_are_not_workflow_labels() {
    for label in ORDINARY {
        assert!(
            !is_workflow_label(label),
            "{label} should not be a workflow label"
        );
    }
}

#[test]
fn syncable_labels_strips_workflow_labels() {
    let local = vec![
        "bug".to_string(),
        "route:full".to_string(),
        "needs-triage".to_string(),
    ];
    assert_eq!(syncable_labels(&local), vec!["bug".to_string()]);
}

#[test]
fn keep_workflow_labels_never_introduces_one_from_remote() {
    let local = vec!["needs-triage".to_string()];
    // A remote label list can never actually contain a workflow-shaped string
    // (GitHub never sees them), but the merge strips defensively either way.
    let remote = vec!["bug".to_string(), "route:full".to_string()];
    let merged = keep_workflow_labels(&local, &remote);
    assert!(
        !merged
            .iter()
            .any(|l| is_workflow_label(l) && l == "route:full")
    );
    assert_eq!(merged, vec!["bug".to_string(), "needs-triage".to_string()]);
}

#[test]
fn keep_workflow_labels_preserves_local_workflow_labels() {
    let local = vec!["needs-triage".to_string(), "dispatched".to_string()];
    let remote = vec!["bug".to_string()];
    let merged = keep_workflow_labels(&local, &remote);
    assert!(merged.contains(&"needs-triage".to_string()));
    assert!(merged.contains(&"dispatched".to_string()));
    assert!(merged.contains(&"bug".to_string()));
}

#[test]
fn keep_workflow_labels_drops_workflow_labels_no_longer_local() {
    // A workflow label removed locally must not resurface via the merge.
    let local: Vec<String> = vec![];
    let remote = vec!["bug".to_string()];
    let merged = keep_workflow_labels(&local, &remote);
    assert_eq!(merged, vec!["bug".to_string()]);
}

#[test]
fn workflow_label_list_is_declared_exactly_once() {
    // Non-test source only: this very assertion has to name the const to test
    // it, which would otherwise self-match as a second "declaration".
    let count = count_occurrences_in_non_test_source("const WORKFLOW_LABEL_PREFIXES");
    assert_eq!(
        count, 1,
        "WORKFLOW_LABEL_PREFIXES must be declared exactly once in the crate"
    );
}

fn count_occurrences_in_non_test_source(needle: &str) -> usize {
    let src_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut count = 0;
    visit(&src_dir, needle, &mut count);
    count
}

fn visit(dir: &std::path::Path, needle: &str, count: &mut usize) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            visit(&path, needle, count);
            continue;
        }
        let is_test_file = path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.ends_with("_tests.rs"));
        if is_test_file || path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        if let Ok(contents) = std::fs::read_to_string(&path) {
            *count += contents.matches(needle).count();
        }
    }
}
