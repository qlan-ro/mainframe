#[test]
fn encodes_cwd_the_claude_way_and_points_at_the_jsonl() {
    let home = dirs::home_dir().unwrap();
    let expected = home
        .join(".claude")
        .join("projects")
        .join("-Users-x-proj")
        .join("sess-abc.jsonl")
        .to_string_lossy()
        .into_owned();
    assert_eq!(
        compute_session_file_path("/Users/x/proj", "sess-abc"),
        expected
    );
}

#[test]
fn encodes_non_alphanumerics_to_dashes() {
    let home = dirs::home_dir().unwrap();
    let expected = home
        .join(".claude")
        .join("projects")
        .join("-a-b-c-worktrees-x")
        .join("sid.jsonl")
        .to_string_lossy()
        .into_owned();
    assert_eq!(
        compute_session_file_path("/a/b.c/worktrees/x", "sid"),
        expected
    );
}

#[test]
fn sanitizes_a_malicious_session_id_so_it_cannot_traverse() {
    let p = compute_session_file_path("/proj", "../../etc/passwd");
    assert!(!p.contains(".."));
    assert!(p.ends_with(".jsonl"));
}
