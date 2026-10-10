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

#[test]
fn codex_init_persists_a_session_id_without_a_claude_path() {
    let active = cell(ProcessState::Working, None);
    active.lock().unwrap().chat.adapter_id = "codex".to_string();
    let deps = FakeDeps::new(active.clone(), Vec::new());
    *deps.project_path.lock().unwrap() = Some("/proj".to_string());
    let handler = EventHandler::new(
        Arc::new(Mutex::new(MessageCache::new())),
        Arc::new(Mutex::new(PermissionManager::new())),
        deps.clone(),
    );

    handler.build_sink("c1", None).on_init("codex-session");

    let guard = active.lock().unwrap();
    let chat = &guard.chat;
    assert_eq!(chat.claude_session_id.as_deref(), Some("codex-session"));
    assert_eq!(chat.session_file_path, None);
    let updates = deps.updates.lock().unwrap();
    assert_eq!(updates.len(), 1);
    assert_eq!(updates[0].session_file_path, None);
}

#[test]
fn claude_init_persists_the_existing_transcript_path() {
    let active = cell(ProcessState::Working, None);
    let deps = FakeDeps::new(active.clone(), Vec::new());
    *deps.project_path.lock().unwrap() = Some("/proj".to_string());
    let handler = EventHandler::new(
        Arc::new(Mutex::new(MessageCache::new())),
        Arc::new(Mutex::new(PermissionManager::new())),
        deps.clone(),
    );
    let expected = dirs::home_dir()
        .unwrap()
        .join(".claude/projects/-proj/claude-session.jsonl")
        .to_string_lossy()
        .into_owned();

    handler.build_sink("c1", None).on_init("claude-session");

    assert_eq!(active.lock().unwrap().chat.session_file_path.as_deref(), Some(expected.as_str()));
    let updates = deps.updates.lock().unwrap();
    assert_eq!(updates.len(), 2);
    assert_eq!(updates[1].session_file_path.as_deref(), Some(expected.as_str()));
}
