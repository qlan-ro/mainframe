use super::*;

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
fn parse_branch_tracking_reads_upstream_and_divergence() {
    let output = [
        "main\0origin/main\0origin\0refs/heads/main\0",
        "feat/x\0origin/feature/x\0origin\0refs/heads/feature/x\0ahead 2, behind 5",
        "only-ahead\0origin/only-ahead\0origin\0refs/heads/only-ahead\0ahead 3",
        "only-behind\0upstream/main\0upstream\0refs/heads/main\0behind 1",
    ]
    .join("\n");
    let tracking =
        |branch: &str, upstream: &str, remote: &str, remote_branch: &str, ahead, behind| {
            BranchTracking {
                branch: branch.to_string(),
                upstream: upstream.to_string(),
                remote: remote.to_string(),
                remote_branch: remote_branch.to_string(),
                ahead,
                behind,
            }
        };
    assert_eq!(
        parse_branch_tracking(&output),
        vec![
            tracking("main", "origin/main", "origin", "main", 0, 0),
            tracking("feat/x", "origin/feature/x", "origin", "feature/x", 2, 5),
            tracking(
                "only-ahead",
                "origin/only-ahead",
                "origin",
                "only-ahead",
                3,
                0
            ),
            tracking("only-behind", "upstream/main", "upstream", "main", 0, 1),
        ]
    );
}

#[test]
fn parse_branch_tracking_skips_untracked_and_gone_upstreams() {
    let output = "local-only\0\0\0\0\nstale\0origin/stale\0origin\0refs/heads/stale\0gone\n";
    assert_eq!(parse_branch_tracking(output), Vec::new());
}
