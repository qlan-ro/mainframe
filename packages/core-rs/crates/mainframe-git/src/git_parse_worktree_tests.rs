use super::{WorktreeEntry, parse_worktree_list};

#[test]
fn parses_branch_and_detached_records() {
    let output = "worktree /a\nbranch refs/heads/main\n\nworktree /b\ndetached\n\n";
    assert_eq!(
        parse_worktree_list(output),
        vec![
            WorktreeEntry {
                path: "/a".into(),
                branch: Some("refs/heads/main".into())
            },
            WorktreeEntry {
                path: "/b".into(),
                branch: None
            },
        ]
    );
}
