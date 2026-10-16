#[test]
fn parse_status_z_empty() {
    assert_eq!(
        parse_status_z(""),
        PorcelainStatus {
            conflicted: vec![],
            files: vec![]
        }
    );
}

#[test]
fn parse_status_z_plain_modified() {
    assert_eq!(
        parse_status_z(" M src/foo.ts\0"),
        PorcelainStatus {
            conflicted: vec![],
            files: vec![status_file("src/foo.ts", " ", "M")],
        }
    );
}

#[test]
fn parse_status_z_rename_consumes_source_token() {
    assert_eq!(
        parse_status_z("R  renamed.txt\0a.txt\0"),
        PorcelainStatus {
            conflicted: vec![],
            files: vec![status_file("renamed.txt", "R", " ")],
        }
    );
}

#[test]
fn parse_status_z_uu_conflict() {
    assert_eq!(
        parse_status_z("UU f.txt\0"),
        PorcelainStatus {
            conflicted: vec!["f.txt".to_string()],
            files: vec![status_file("f.txt", "U", "U")],
        }
    );
}

#[test]
fn parse_status_z_rename_and_conflict_together() {
    assert_eq!(
        parse_status_z("R  renamed.txt\0a.txt\0UU f.txt\0"),
        PorcelainStatus {
            conflicted: vec!["f.txt".to_string()],
            files: vec![
                status_file("renamed.txt", "R", " "),
                status_file("f.txt", "U", "U"),
            ],
        }
    );
}

#[test]
fn parse_status_z_skips_ignored() {
    assert_eq!(
        parse_status_z("!! build/\0 M kept.ts\0"),
        PorcelainStatus {
            conflicted: vec![],
            files: vec![status_file("kept.ts", " ", "M")],
        }
    );
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
