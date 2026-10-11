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
    let expected = dirs::home_dir()
        .unwrap()
        .join(".claude/projects/-proj/------etc-passwd.jsonl")
        .to_string_lossy()
        .into_owned();
    assert_eq!(p, expected);
}

fn lookup(adapter_id: &str, session_id: &str) -> (String, String, String) {
    (
        adapter_id.to_string(),
        session_id.to_string(),
        "/proj".to_string(),
    )
}

#[test]
fn init_without_an_adapter_transcript_path_persists_only_the_session_id() {
    let active = cell(ProcessState::Working, None);
    active.lock().unwrap().chat.adapter_id = "codex".to_string();
    let h = Harness::new(active.clone());
    h.deps.set_project_path("/proj");

    h.sink("c1").on_init("codex-session");

    assert_eq!(
        *h.deps.adapters.transcript_lookups.lock().unwrap(),
        vec![lookup("codex", "codex-session")]
    );
    let guard = active.lock().unwrap();
    assert_eq!(guard.chat.claude_session_id.as_deref(), Some("codex-session"));
    assert_eq!(guard.chat.session_file_path, None);
    let updates = h.deps.store.updates.lock().unwrap();
    assert_eq!(updates.len(), 1);
    assert_eq!(updates[0].1.session_file_path, None);
}

#[test]
fn init_persists_the_adapter_transcript_path() {
    let active = cell(ProcessState::Working, None);
    let h = Harness::new(active.clone());
    h.deps.set_project_path("/proj");
    *h.deps.adapters.transcript_path.lock().unwrap() =
        Some("/transcripts/claude-session.jsonl".to_string());

    h.sink("c1").on_init("claude-session");

    assert_eq!(
        *h.deps.adapters.transcript_lookups.lock().unwrap(),
        vec![lookup("claude", "claude-session")]
    );
    assert_eq!(
        active.lock().unwrap().chat.session_file_path.as_deref(),
        Some("/transcripts/claude-session.jsonl")
    );
    let updates = h.deps.store.updates.lock().unwrap();
    assert_eq!(updates.len(), 2);
    assert_eq!(
        updates[1].1.session_file_path.as_deref(),
        Some("/transcripts/claude-session.jsonl")
    );
}
