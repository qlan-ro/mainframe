use mainframe_types::orchestration::SecretToken;

use super::*;

fn argv(cmd: &tokio::process::Command) -> Vec<String> {
    cmd.as_std()
        .get_args()
        .map(|a| a.to_string_lossy().into_owned())
        .collect()
}

#[test]
fn launch_adds_three_config_overrides_and_the_env_token() {
    let mut cmd = tokio::process::Command::new("codex");
    cmd.arg("app-server");
    let launch = OrchestrationMcpLaunch {
        url: "http://127.0.0.1:31415/mcp".into(),
        token: SecretToken::new("raw-token".into()),
    };
    apply_orchestration(&mut cmd, Some(&launch));
    assert_eq!(
        argv(&cmd),
        vec![
            "app-server",
            "-c",
            "mcp_servers.mainframe.url=\"http://127.0.0.1:31415/mcp\"",
            "-c",
            "mcp_servers.mainframe.bearer_token_env_var=\"MAINFRAME_MCP_TOKEN\"",
            "-c",
            "mcp_servers.mainframe.tool_timeout_sec=3900",
        ]
    );
    assert!(!argv(&cmd).join(" ").contains("raw-token"));
    let token = cmd
        .as_std()
        .get_envs()
        .find(|(k, _)| *k == MCP_TOKEN_ENV)
        .and_then(|(_, v)| v)
        .map(|v| v.to_string_lossy().into_owned());
    assert_eq!(token.as_deref(), Some("raw-token"));
}

#[test]
fn no_launch_adds_no_args() {
    let mut cmd = tokio::process::Command::new("codex");
    apply_orchestration(&mut cmd, None);
    assert!(argv(&cmd).is_empty());
}

#[test]
fn additional_context_carries_the_orchestration_prompt_as_application_kind() {
    let ctx = additional_context();
    let entry = &ctx["mainframe_orchestration"];
    assert_eq!(entry["kind"], "application");
    assert_eq!(
        entry["value"].as_str().unwrap(),
        mainframe_orchestration::ORCHESTRATION_SYSTEM_PROMPT
    );
}

#[test]
fn only_mainframe_elicitations_are_accepted() {
    let ours = elicitation_response(&json!({ "serverName": "mainframe" }));
    assert_eq!(ours, json!({ "action": "accept" }));
    let theirs = elicitation_response(&json!({ "serverName": "other" }));
    assert_eq!(theirs, json!({ "action": "decline" }));
}
