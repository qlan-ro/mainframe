use super::*;
#[test]
fn a_proxy_session_is_pointed_at_the_endpoint_and_stripped_of_the_real_api_key() {
    let env = spawn_env(Some(&CliProxyEnv {
        base_url: "http://127.0.0.1:8317".to_string(),
        auth_token: "sk-proxy".to_string(),
        small_fast_model: "gpt-5.4-mini".to_string(),
    }));

    assert_eq!(
        env.get("ANTHROPIC_BASE_URL").cloned().flatten().as_deref(),
        Some("http://127.0.0.1:8317")
    );
    assert_eq!(
        env.get("ANTHROPIC_AUTH_TOKEN")
            .cloned()
            .flatten()
            .as_deref(),
        Some("sk-proxy")
    );
    for key in [
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        "ANTHROPIC_SMALL_FAST_MODEL",
    ] {
        assert_eq!(
            env.get(key).cloned().flatten().as_deref(),
            Some("gpt-5.4-mini"),
            "{key}"
        );
    }
    assert_eq!(env.get("ANTHROPIC_API_KEY"), Some(&None));
}

#[test]
fn accept_edits_mode_passes_permission_mode_accept_edits() {
    let (args, _) = build_args(
        &spawn_opts(Some(ExecutionMode::AcceptEdits)),
        &crate::fork::ResumeTarget::Fresh,
        false,
    );
    assert_eq!(mode_arg(&args), "acceptEdits");
}

#[test]
fn undefined_permission_mode_defaults_to_default() {
    let (args, _) = build_args(&spawn_opts(None), &crate::fork::ResumeTarget::Fresh, false);
    assert_eq!(mode_arg(&args), "default");
    assert!(
        args.iter()
            .any(|a| a == "--allow-dangerously-skip-permissions")
    );
}

#[test]
fn does_not_pass_effort_but_passes_model() {
    let mut o = spawn_opts(None);
    o.model = Some("opus".to_string());
    o.tuning = Some(ResolvedTuning {
        effort: Some(mainframe_types::adapter::EffortLevel::High),
        fast: false,
        ultracode: false,
        adaptive_thinking: false,
    });
    let (args, _) = build_args(&o, &crate::fork::ResumeTarget::Fresh, false);
    assert!(!args.iter().any(|a| a == "--effort"));
    assert!(args.iter().any(|a| a == "--model"));
}

#[test]
fn normal_spawn_still_resumes_when_a_resume_id_is_supplied() {
    let (args, _) = build_args(
        &spawn_opts(None),
        &crate::fork::ResumeTarget::Own("sess-123".to_string()),
        false,
    );
    let i = args.iter().position(|a| a == "--resume").unwrap();
    assert_eq!(args[i + 1], "sess-123");
}

#[test]
fn own_target_resumes_plainly_without_fork_session() {
    let (args, _) = build_args(
        &spawn_opts(None),
        &crate::fork::ResumeTarget::Own("own-session-id".to_string()),
        false,
    );
    let i = args.iter().position(|a| a == "--resume").unwrap();
    assert_eq!(args[i + 1], "own-session-id");
    assert!(!args.iter().any(|a| a == "--fork-session"));
}

#[test]
fn a_native_session_carries_no_endpoint_env() {
    let env = spawn_env(None);
    assert!(!env.contains_key("ANTHROPIC_BASE_URL"));
    assert!(!env.contains_key("ANTHROPIC_AUTH_TOKEN"));
    assert!(!env.contains_key("ANTHROPIC_API_KEY"));
    assert!(!env.contains_key("ANTHROPIC_DEFAULT_HAIKU_MODEL"));
}

#[test]
fn inherited_model_omits_cli_override() {
    let mut options = spawn_opts(None);
    options.model = Some("default".into());
    let (args, _) = build_args(&options, &crate::fork::ResumeTarget::Fresh, false);
    assert!(!args.iter().any(|arg| arg == "--model"));
    options.model = Some("claude-opus-5".into());
    let (args, _) = build_args(&options, &crate::fork::ResumeTarget::Fresh, false);
    let index = args.iter().position(|arg| arg == "--model").unwrap();
    assert_eq!(args[index + 1], "claude-opus-5");
}

#[test]
fn plan_mode_passes_permission_mode_plan() {
    let mut o = spawn_opts(Some(ExecutionMode::Default));
    o.plan_mode = Some(true);
    let (args, _) = build_args(&o, &crate::fork::ResumeTarget::Fresh, false);
    assert_eq!(mode_arg(&args), "plan");
    assert!(
        args.iter()
            .any(|a| a == "--allow-dangerously-skip-permissions")
    );
}

#[test]
fn yolo_mode_passes_permission_mode_bypass_permissions() {
    let (args, _) = build_args(
        &spawn_opts(Some(ExecutionMode::Yolo)),
        &crate::fork::ResumeTarget::Fresh,
        false,
    );
    assert_eq!(mode_arg(&args), "bypassPermissions");
}

#[test]
fn includes_partial_messages_flag_only_when_supported() {
    let (without, _) = build_args(&spawn_opts(None), &crate::fork::ResumeTarget::Fresh, false);
    assert!(!without.iter().any(|a| a == "--include-partial-messages"));
    let (with, _) = build_args(&spawn_opts(None), &crate::fork::ResumeTarget::Fresh, true);
    let i = with
        .iter()
        .position(|a| a == "--include-partial-messages")
        .unwrap();
    assert_eq!(with[i - 1], "--replay-user-messages");
}

#[test]
fn omits_no_session_persistence_by_default() {
    let (args, _) = build_args(&spawn_opts(None), &crate::fork::ResumeTarget::Fresh, false);
    assert!(!args.iter().any(|a| a == "--no-session-persistence"));
}

#[test]
fn no_persistence_spawn_never_resumes_even_with_a_resume_id_supplied() {
    let mut o = spawn_opts(None);
    o.no_persistence = Some(true);
    let (args, _) = build_args(
        &o,
        &crate::fork::ResumeTarget::Own("sess-123".to_string()),
        false,
    );
    assert!(!args.iter().any(|a| a == "--resume"));
    assert!(!args.iter().any(|a| a == "sess-123"));
}

#[test]
fn fork_target_resumes_the_snapshot_with_fork_session() {
    let (args, _) = build_args(
        &spawn_opts(None),
        &crate::fork::ResumeTarget::Fork("/snap/n1/parent.jsonl".to_string()),
        false,
    );
    let i = args.iter().position(|a| a == "--resume").unwrap();
    assert_eq!(args[i + 1], "/snap/n1/parent.jsonl");
    assert!(args.iter().any(|a| a == "--fork-session"));
}

/// A from-message fork reuses the whole-chat spawn: the cut lives entirely in
/// the pinned prefix snapshot, so the CLI's hidden `--resume-session-at` is
/// never needed (spec "Claude: pin a prefix snapshot").
#[tokio::test]
async fn a_from_message_fork_resumes_the_prefix_snapshot_with_fork_session() {
    let project = tempfile::tempdir().unwrap();
    let snapshots = tempfile::tempdir().unwrap();
    let transcript = project.path().join("parent.jsonl");
    std::fs::write(
        &transcript,
        concat!(
            r#"{"type":"user","uuid":"u1","message":{"role":"user","content":"a"}}"#,
            "\n",
            r#"{"type":"assistant","uuid":"a1","parentUuid":"u1","message":{"role":"assistant","content":"b"}}"#,
            "\n",
            r#"{"type":"user","uuid":"u2","parentUuid":"a1","message":{"role":"user","content":"c"}}"#,
            "\n",
        ),
    )
    .unwrap();
    let source = crate::fork::pin_fork_point(mainframe_adapter_api::ForkPinRequest {
        source_session_id: "parent".to_string(),
        cwd: "/unused".to_string(),
        session_file_path: Some(transcript.to_string_lossy().into_owned()),
        dest_dir: snapshots.path().to_string_lossy().into_owned(),
        cut: Some(mainframe_adapter_api::ForkCut {
            vendor_message_id: "u2".to_string(),
        }),
    })
    .await
    .unwrap();
    let prefix_path = source.resume_path.clone().unwrap();

    let target = crate::fork::resolve_resume(None, false, Some(&source));
    let (args, _) = build_args(&spawn_opts(None), &target, false);

    let i = args.iter().position(|a| a == "--resume").unwrap();
    assert_eq!(args[i + 1], prefix_path);
    assert!(args.iter().any(|a| a == "--fork-session"));
    assert!(!args.iter().any(|a| a == "--resume-session-at"));
}

#[test]
fn spawn_command_carries_the_resolved_path() {
    let cmd = build_spawn_command(
        "claude",
        &["--version".to_string()],
        "/tmp",
        "/opt/homebrew/bin:/usr/bin",
        None,
    );
    let path = cmd
        .as_std()
        .get_envs()
        .find(|(k, _)| *k == std::ffi::OsStr::new("PATH"))
        .and_then(|(_, v)| v)
        .map(|v| v.to_string_lossy().into_owned());
    assert_eq!(path.as_deref(), Some("/opt/homebrew/bin:/usr/bin"));
}

#[test]
fn default_mode_passes_permission_mode_default() {
    let (args, _) = build_args(
        &spawn_opts(Some(ExecutionMode::Default)),
        &crate::fork::ResumeTarget::Fresh,
        false,
    );
    assert_eq!(mode_arg(&args), "default");
    assert!(
        args.iter()
            .any(|a| a == "--allow-dangerously-skip-permissions")
    );
    assert!(!args.iter().any(|a| a == "--dangerously-skip-permissions"));
}

#[test]
fn auto_mode_passes_permission_mode_auto() {
    let (args, _) = build_args(
        &spawn_opts(Some(ExecutionMode::Auto)),
        &crate::fork::ResumeTarget::Fresh,
        false,
    );
    assert_eq!(mode_arg(&args), "auto");
}

#[test]
fn omits_append_system_prompt_by_default() {
    let (args, _) = build_args(&spawn_opts(None), &crate::fork::ResumeTarget::Fresh, false);
    assert!(!args.iter().any(|a| a == "--append-system-prompt"));
}

#[test]
fn includes_append_system_prompt_when_enabled() {
    let mut o = spawn_opts(None);
    o.system_prompt = Some("enabled".to_string());
    let (args, _) = build_args(&o, &crate::fork::ResumeTarget::Fresh, false);
    let i = args
        .iter()
        .position(|a| a == "--append-system-prompt")
        .unwrap();
    assert_eq!(args[i + 1], MAINFRAME_SYSTEM_PROMPT_APPEND);
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
