#[test]
fn omits_the_orchestration_prompt_when_no_orchestration_mcp_is_attached() {
    let (args, _) = build_args(&spawn_opts(None), &crate::fork::ResumeTarget::Fresh, false);
    assert!(!args.iter().any(|a| a == "--append-system-prompt"));
}

#[test]
fn appends_the_orchestration_prompt_once_an_orchestration_mcp_launch_is_set() {
    let mut o = spawn_opts(None);
    o.orchestration_mcp = Some(mainframe_types::orchestration::OrchestrationMcpLaunch {
        url: "http://127.0.0.1:31415/mcp".into(),
        token: mainframe_types::orchestration::SecretToken::new("tok".into()),
    });
    let (args, _) = build_args(&o, &crate::fork::ResumeTarget::Fresh, false);
    let i = args
        .iter()
        .position(|a| a == "--append-system-prompt")
        .unwrap();
    assert_eq!(
        args[i + 1],
        mainframe_orchestration::ORCHESTRATION_SYSTEM_PROMPT
    );
}

#[test]
fn combines_the_askuserquestion_and_orchestration_prompts_into_one_flag() {
    let mut o = spawn_opts(None);
    o.system_prompt = Some("enabled".to_string());
    o.orchestration_mcp = Some(mainframe_types::orchestration::OrchestrationMcpLaunch {
        url: "http://127.0.0.1:31415/mcp".into(),
        token: mainframe_types::orchestration::SecretToken::new("tok".into()),
    });
    let (args, _) = build_args(&o, &crate::fork::ResumeTarget::Fresh, false);
    // Exactly one `--append-system-prompt` occurrence: the CLI's own argParser
    // keeps only the last value of a repeated flag, so both pieces of text
    // must ride in the same argv slot (see `append_system_prompt_text`).
    assert_eq!(
        args.iter()
            .filter(|a| *a == "--append-system-prompt")
            .count(),
        1
    );
    let i = args
        .iter()
        .position(|a| a == "--append-system-prompt")
        .unwrap();
    assert!(args[i + 1].contains(MAINFRAME_SYSTEM_PROMPT_APPEND));
    assert!(args[i + 1].contains(mainframe_orchestration::ORCHESTRATION_SYSTEM_PROMPT));
}

#[test]
fn no_persistence_true_adds_the_flag() {
    let mut o = spawn_opts(None);
    o.no_persistence = Some(true);
    let (args, _) = build_args(&o, &crate::fork::ResumeTarget::Fresh, false);
    assert!(args.iter().any(|a| a == "--no-session-persistence"));
}

#[test]
fn no_persistence_spawn_never_resumes_a_fork_snapshot() {
    let mut o = spawn_opts(None);
    o.no_persistence = Some(true);
    let (args, _) = build_args(
        &o,
        &crate::fork::ResumeTarget::Fork("/snap/n1/parent.jsonl".to_string()),
        false,
    );
    assert!(!args.iter().any(|a| a == "--resume"));
    assert!(!args.iter().any(|a| a == "--fork-session"));
}

#[test]
fn resolve_resume_falls_back_to_fork_source_when_own_transcript_is_missing() {
    let source = mainframe_types::adapter::ForkSource {
        source_session_id: "parent-id".to_string(),
        resume_path: Some("/snap/n1/parent-id.jsonl".to_string()),
        last_turn_id: None,
    };
    let target = crate::fork::resolve_resume(Some("own-id"), false, Some(&source));
    assert_eq!(
        target,
        crate::fork::ResumeTarget::Fork("/snap/n1/parent-id.jsonl".to_string())
    );
    let (args, _) = build_args(&spawn_opts(None), &target, false);
    let i = args.iter().position(|a| a == "--resume").unwrap();
    assert_eq!(args[i + 1], "/snap/n1/parent-id.jsonl");
    assert!(args.iter().any(|a| a == "--fork-session"));
}

#[test]
fn a_spawn_with_an_orchestration_launch_gets_the_mcp_server_after_the_mode_flags() {
    let mut options = spawn_opts(None);
    options.orchestration_mcp = Some(mainframe_types::orchestration::OrchestrationMcpLaunch {
        url: "http://127.0.0.1:31415/mcp".into(),
        token: mainframe_types::orchestration::SecretToken::new("tok".into()),
    });
    let (args, _) = build_args(&options, &crate::fork::ResumeTarget::Fresh, false);
    let at = args.iter().position(|a| a == "--mcp-config").unwrap();
    assert!(at > args.iter().position(|a| a == "--permission-mode").unwrap());
    assert_eq!(args[at + 2], "--allowedTools");
    assert_eq!(args[at + 3], "mcp__mainframe");
    assert!(!args.iter().any(|a| a.contains("tok\"")));

    let (plain, _) = build_args(&spawn_opts(None), &crate::fork::ResumeTarget::Fresh, false);
    assert!(!plain.iter().any(|a| a == "--mcp-config"));
}
