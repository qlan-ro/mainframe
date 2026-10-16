use super::*;

fn err(message: &str) -> GitExecError {
    GitExecError {
        message: message.to_string(),
        code: None,
        stdout: None,
        stderr: None,
    }
}

fn diff(status: &str, path: &str) -> DiffEntry {
    DiffEntry {
        status: status.to_string(),
        path: path.to_string(),
        old_path: None,
    }
}

fn diff_renamed(status: &str, path: &str, old_path: &str) -> DiffEntry {
    DiffEntry {
        status: status.to_string(),
        path: path.to_string(),
        old_path: Some(old_path.to_string()),
    }
}

// ---- isNotGitRepo ----

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

// ---- parseDiffNameStatus ----

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

// ---- parseStatusLines ----

#[test]
fn parse_status_lines_modified() {
    assert_eq!(
        parse_status_lines("M  src/foo.ts\0"),
        vec![diff("M", "src/foo.ts")]
    );
}

#[test]
fn parse_status_lines_multiple_statuses() {
    let result = parse_status_lines("M  src/staged.ts\0 M src/unstaged.ts\0?? src/new.ts\0");
    assert_eq!(result.len(), 3);
    assert_eq!(result[0], diff("M", "src/staged.ts"));
    assert_eq!(result[1], diff("M", "src/unstaged.ts"));
    assert_eq!(result[2], diff("??", "src/new.ts"));
}

#[test]
fn parse_status_lines_renamed_consumes_source_token() {
    let result = parse_status_lines("R  src/new.ts\0src/old.ts\0");
    assert_eq!(result.len(), 1);
    assert_eq!(result[0], diff_renamed("R", "src/new.ts", "src/old.ts"));
}

#[test]
fn parse_status_lines_copied_consumes_source_token() {
    let result = parse_status_lines("C  src/copy.ts\0src/original.ts\0");
    assert_eq!(result.len(), 1);
    assert_eq!(
        result[0],
        diff_renamed("C", "src/copy.ts", "src/original.ts")
    );
}

#[test]
fn parse_status_lines_filters_directories() {
    let result = parse_status_lines("M  src/foo.ts\0A  src/dir/\0");
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].path, "src/foo.ts");
}

#[test]
fn parse_status_lines_empty() {
    assert_eq!(parse_status_lines(""), Vec::<DiffEntry>::new());
}

#[test]
fn parse_status_lines_keeps_spaces_and_unicode_verbatim() {
    let result = parse_status_lines("?? my file.ts\0 M src/caf\u{e9} menu.ts\0R  b c.ts\0a b.ts\0");
    assert_eq!(
        result,
        vec![
            diff("??", "my file.ts"),
            diff("M", "src/caf\u{e9} menu.ts"),
            diff_renamed("R", "b c.ts", "a b.ts"),
        ]
    );
}

// ---- parseStatusBuckets ----

#[test]
fn parse_status_buckets_empty() {
    assert_eq!(
        parse_status_buckets(""),
        StatusBuckets {
            staged: vec![],
            unstaged: vec![],
            untracked: vec![]
        }
    );
}

#[test]
fn parse_status_buckets_untracked() {
    assert_eq!(
        parse_status_buckets("?? src/new.ts\0"),
        StatusBuckets {
            staged: vec![],
            unstaged: vec![],
            untracked: vec!["src/new.ts".to_string()]
        }
    );
}

#[test]
fn parse_status_buckets_staged_only() {
    let result = parse_status_buckets("M  src/staged.ts\0");
    assert!(result.staged.contains(&"src/staged.ts".to_string()));
    assert!(!result.unstaged.contains(&"src/staged.ts".to_string()));
    assert!(!result.untracked.contains(&"src/staged.ts".to_string()));
}

#[test]
fn parse_status_buckets_working_only() {
    let result = parse_status_buckets(" M src/unstaged.ts\0");
    assert!(!result.staged.contains(&"src/unstaged.ts".to_string()));
    assert!(result.unstaged.contains(&"src/unstaged.ts".to_string()));
    assert!(!result.untracked.contains(&"src/unstaged.ts".to_string()));
}

#[test]
fn parse_status_buckets_both() {
    let result = parse_status_buckets("MM src/both.ts\0");
    assert!(result.staged.contains(&"src/both.ts".to_string()));
    assert!(result.unstaged.contains(&"src/both.ts".to_string()));
    assert!(!result.untracked.contains(&"src/both.ts".to_string()));
}

#[test]
fn parse_status_buckets_full() {
    assert_eq!(
        parse_status_buckets("M  src/staged.ts\0 M src/unstaged.ts\0?? src/new.ts\0"),
        StatusBuckets {
            staged: vec!["src/staged.ts".to_string()],
            unstaged: vec!["src/unstaged.ts".to_string()],
            untracked: vec!["src/new.ts".to_string()],
        }
    );
}

// ---- parseBranchList ----

#[test]
fn parse_branch_list_current_marker() {
    assert_eq!(
        parse_branch_list("  feature\n* main\n"),
        BranchList {
            current: "main".to_string(),
            all: vec!["feature".to_string(), "main".to_string()]
        }
    );
}

#[test]
fn parse_branch_list_detached_at() {
    assert_eq!(
        parse_branch_list("* (HEAD detached at 4be41bd)\n  feature\n  main\n"),
        BranchList {
            current: "4be41bd".to_string(),
            all: vec![
                "4be41bd".to_string(),
                "feature".to_string(),
                "main".to_string()
            ]
        }
    );
}

#[test]
fn parse_branch_list_detached_from() {
    let result = parse_branch_list("* (HEAD detached from origin/main)\n  main\n");
    assert_eq!(result.current, "origin/main");
    assert!(result.all.contains(&"origin/main".to_string()));
}

#[test]
fn parse_branch_list_keeps_remotes_head_pseudo_ref() {
    assert_eq!(
        parse_branch_list(
            "  feature\n* main\n  remotes/origin/HEAD -> origin/main\n  remotes/origin/main\n"
        ),
        BranchList {
            current: "main".to_string(),
            all: vec![
                "feature".to_string(),
                "main".to_string(),
                "remotes/origin/HEAD".to_string(),
                "remotes/origin/main".to_string(),
            ],
        }
    );
}

#[test]
fn parse_branch_list_empty_current_when_none_checked_out() {
    assert_eq!(
        parse_branch_list("  feature\n  main\n"),
        BranchList {
            current: String::new(),
            all: vec!["feature".to_string(), "main".to_string()]
        }
    );
}

#[test]
fn parse_branch_list_empty() {
    assert_eq!(
        parse_branch_list(""),
        BranchList {
            current: String::new(),
            all: vec![]
        }
    );
}

#[test]
fn parse_status_buckets_spaced_paths_and_rename() {
    assert_eq!(
        parse_status_buckets("R  new name.ts\0old name.ts\0 M my file.ts\0?? notes draft.md\0"),
        StatusBuckets {
            staged: vec!["new name.ts".to_string()],
            unstaged: vec!["my file.ts".to_string()],
            untracked: vec!["notes draft.md".to_string()],
        }
    );
}
