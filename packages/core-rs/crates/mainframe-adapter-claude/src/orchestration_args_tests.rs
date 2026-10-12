use mainframe_types::orchestration::SecretToken;
use serde_json::Value;

use super::*;

fn launch() -> OrchestrationMcpLaunch {
    OrchestrationMcpLaunch {
        url: "http://127.0.0.1:31415/mcp".into(),
        token: SecretToken::new("raw-token-value".into()),
    }
}

#[test]
fn args_carry_the_placeholder_timeout_and_allow_rule_but_never_the_token() {
    let args = orchestration_args(Some(&launch()));
    assert_eq!(args[0], "--mcp-config");
    assert_eq!(args[2], "--allowedTools");
    assert_eq!(args[3], "mcp__mainframe");
    assert!(!args.join(" ").contains("raw-token-value"));
    let config: Value = serde_json::from_str(&args[1]).unwrap();
    let server = &config["mcpServers"]["mainframe"];
    assert_eq!(server["type"], "http");
    assert_eq!(server["url"], "http://127.0.0.1:31415/mcp");
    assert_eq!(
        server["headers"]["Authorization"],
        "Bearer ${MAINFRAME_MCP_TOKEN}"
    );
    assert_eq!(server["timeout"], 3_900_000);
    assert!(server.get("alwaysLoad").is_none());
}

#[test]
fn no_launch_adds_nothing_and_clears_the_env() {
    assert!(orchestration_args(None).is_empty());
    let mut cmd = tokio::process::Command::new("claude");
    apply_orchestration_env(&mut cmd, None);
    let removed = cmd
        .as_std()
        .get_envs()
        .any(|(k, v)| k == MCP_TOKEN_ENV && v.is_none());
    assert!(removed);
}

#[test]
fn the_token_rides_in_the_child_env() {
    let mut cmd = tokio::process::Command::new("claude");
    apply_orchestration_env(&mut cmd, Some(&launch()));
    let value = cmd
        .as_std()
        .get_envs()
        .find(|(k, _)| *k == MCP_TOKEN_ENV)
        .and_then(|(_, v)| v)
        .map(|v| v.to_string_lossy().into_owned());
    assert_eq!(value.as_deref(), Some("raw-token-value"));
}
