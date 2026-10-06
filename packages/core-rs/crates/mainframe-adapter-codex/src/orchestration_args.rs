//! Gives a chat's `codex app-server` the Mainframe orchestration MCP server.
//!
//! Each chat runs its own app-server process, so process-scoped `-c` config
//! matches the credential's per-chat scope. The token reaches Codex only
//! through `bearer_token_env_var`, never argv. Pending live verification
//! (spec Gate 0): the three keys, whether streamable HTTP needs a feature
//! flag on the pinned version, and the elicitation request shape.

use mainframe_types::orchestration::{
    MCP_CLIENT_TIMEOUT_MS, MCP_SERVER_NAME, MCP_TOKEN_ENV, OrchestrationMcpLaunch,
};
use serde_json::{Value, json};

/// Appends the `-c` overrides (each its own argv element, no shell) and puts
/// the token in the child's environment; clears an inherited token otherwise.
pub(crate) fn apply_orchestration(
    cmd: &mut tokio::process::Command,
    launch: Option<&OrchestrationMcpLaunch>,
) {
    let Some(launch) = launch else {
        cmd.env_remove(MCP_TOKEN_ENV);
        return;
    };
    // Codex's default per-tool timeout is 60 s, which would cut a blocking
    // wait short; stay above the server's own 60-minute maximum.
    let timeout_sec = MCP_CLIENT_TIMEOUT_MS / 1000;
    let url = toml_string(&launch.url);
    let env = toml_string(MCP_TOKEN_ENV);
    for entry in [
        format!("mcp_servers.{MCP_SERVER_NAME}.url={url}"),
        format!("mcp_servers.{MCP_SERVER_NAME}.bearer_token_env_var={env}"),
        format!("mcp_servers.{MCP_SERVER_NAME}.tool_timeout_sec={timeout_sec}"),
    ] {
        cmd.arg("-c").arg(entry);
    }
    cmd.env(MCP_TOKEN_ENV, launch.token.expose());
}

/// `-c` values are parsed as TOML; a JSON string literal is a valid TOML
/// basic string for the URL and env-var name we pass.
fn toml_string(value: &str) -> String {
    Value::String(value.to_string()).to_string()
}

/// The answer to `mcpServer/elicitation/request`. Mainframe's own server is
/// accepted without a prompt because the daemon enforces the privilege
/// ceiling itself; any other server's elicitation is declined, in the shape
/// elicitation answers take (not the approval `decision` shape).
pub(crate) fn elicitation_response(params: &Value) -> Value {
    let server = params.get("serverName").and_then(Value::as_str);
    if server == Some(MCP_SERVER_NAME) {
        json!({ "action": "accept" })
    } else {
        json!({ "action": "decline" })
    }
}

#[cfg(test)]
mod tests {
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
    fn only_mainframe_elicitations_are_accepted() {
        let ours = elicitation_response(&json!({ "serverName": "mainframe" }));
        assert_eq!(ours, json!({ "action": "accept" }));
        let theirs = elicitation_response(&json!({ "serverName": "other" }));
        assert_eq!(theirs, json!({ "action": "decline" }));
    }
}
