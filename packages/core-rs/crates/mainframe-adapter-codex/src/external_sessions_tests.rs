use super::*;

#[test]
fn parses_rollout_filename_uuid() {
    let name = "rollout-2026-05-01T02-00-47-019de09f-93b4-7832-b2aa-c6b3dae20001.jsonl";
    assert_eq!(
        parse_rollout_uuid(name).as_deref(),
        Some("019de09f-93b4-7832-b2aa-c6b3dae20001")
    );
    assert_eq!(parse_rollout_uuid("notes.txt"), None);
    assert_eq!(parse_rollout_uuid("rollout-nope.jsonl"), None);
}

#[test]
fn cwd_nesting() {
    assert!(mainframe_types::paths::cwd_belongs_to_project(
        Some("/a/b"),
        "/a/b"
    ));
    assert!(mainframe_types::paths::cwd_belongs_to_project(
        Some("/a/b/c"),
        "/a/b"
    ));
    assert!(!mainframe_types::paths::cwd_belongs_to_project(
        Some("/a/bc"),
        "/a/b"
    ));
    assert!(!mainframe_types::paths::cwd_belongs_to_project(
        None, "/a/b"
    ));
}
