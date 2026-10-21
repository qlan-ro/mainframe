use super::*;

fn err(stderr: &str) -> GitExecError {
    GitExecError::Failed {
        command: "status".to_string(),
        code: Some(128),
        stderr: stderr.to_string(),
    }
}

pub(super) fn diff(status: &str, path: &str) -> DiffEntry {
    DiffEntry {
        status: status.to_string(),
        path: path.to_string(),
        old_path: None,
    }
}

pub(super) fn diff_renamed(status: &str, path: &str, old_path: &str) -> DiffEntry {
    DiffEntry {
        status: status.to_string(),
        path: path.to_string(),
        old_path: Some(old_path.to_string()),
    }
}

#[test]
fn is_not_git_repo_true_for_not_a_git_repository() {
    let e = err("fatal: not a git repository (or any of the parent directories): .git");
    assert!(is_not_git_repo(&e));
}

#[test]
fn is_not_git_repo_false_for_other_errors() {
    let e = err("Permission denied");
    assert!(!is_not_git_repo(&e));
}

#[test]
fn parse_diff_name_status_simple_modified() {
    assert_eq!(
        parse_diff_name_status("M\tsrc/foo.ts"),
        vec![diff("M", "src/foo.ts")]
    );
}

#[test]
fn parse_diff_name_status_added_and_deleted() {
    assert_eq!(
        parse_diff_name_status("A\tsrc/new.ts\nD\tsrc/gone.ts"),
        vec![diff("A", "src/new.ts"), diff("D", "src/gone.ts")]
    );
}

#[test]
fn parse_diff_name_status_renamed_with_old_path() {
    assert_eq!(
        parse_diff_name_status("R100\tsrc/old.ts\tsrc/new.ts"),
        vec![diff_renamed("R", "src/new.ts", "src/old.ts")]
    );
}

#[test]
fn parse_diff_name_status_copied_with_old_path() {
    assert_eq!(
        parse_diff_name_status("C100\tsrc/original.ts\tsrc/copy.ts"),
        vec![diff_renamed("C", "src/copy.ts", "src/original.ts")]
    );
}

#[test]
fn parse_diff_name_status_filters_empty_paths() {
    let result = parse_diff_name_status("M\tsrc/foo.ts\nM\t");
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].path, "src/foo.ts");
}

#[test]
fn parse_diff_name_status_empty() {
    assert_eq!(parse_diff_name_status(""), Vec::<DiffEntry>::new());
}

#[test]
fn parse_diff_name_status_multiple() {
    let result = parse_diff_name_status("M\tsrc/foo.ts\nA\tsrc/bar.ts\nD\tsrc/baz.ts");
    assert_eq!(result.len(), 3);
    assert_eq!(result[0], diff("M", "src/foo.ts"));
    assert_eq!(result[1], diff("A", "src/bar.ts"));
    assert_eq!(result[2], diff("D", "src/baz.ts"));
}
