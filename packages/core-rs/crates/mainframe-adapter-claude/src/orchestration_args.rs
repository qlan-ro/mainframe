//! Gives a spawned Claude CLI the Mainframe orchestration MCP server.
//!
//! The CLI parses inline `--mcp-config` JSON with variable expansion, so the
//! header names `${MAINFRAME_MCP_TOKEN}` and the raw token travels only in the
//! child's environment (owner-readable `environ`), never in argv (world-readable
//! `/proc/<pid>/cmdline`). `--allowedTools mcp__mainframe` is a server-wide
//! allow rule: the daemon enforces the privilege ceiling itself, and a
//! user's own `deny` rules still win over this CLI-argument rule.

use mainframe_types::orchestration::{
    MCP_CLIENT_TIMEOUT_MS, MCP_SERVER_NAME, MCP_TOKEN_ENV, OrchestrationMcpLaunch,
};
use serde_json::json;

/// The argv additions for one spawn; empty when the chat gets no tools.
pub(crate) fn orchestration_args(launch: Option<&OrchestrationMcpLaunch>) -> Vec<String> {
    let Some(launch) = launch else {
        return Vec::new();
    };
    // `timeout` lifts both the 60 s per-call cap and the idle abort; it sits
    // above the server's own 60-minute wait maximum so Mainframe decides when
    // a blocking call returns.
    let config = json!({
        "mcpServers": {
            MCP_SERVER_NAME: {
                "type": "http",
                "url": launch.url,
                "headers": { "Authorization": format!("Bearer ${{{MCP_TOKEN_ENV}}}") },
                "timeout": MCP_CLIENT_TIMEOUT_MS,
            }
        }
    });
    vec![
        "--mcp-config".to_string(),
        config.to_string(),
        "--allowedTools".to_string(),
        format!("mcp__{MCP_SERVER_NAME}"),
    ]
}

/// Puts the token in the child's environment, or clears an inherited one so a
/// chat without tools never presents another chat's credential.
pub(crate) fn apply_orchestration_env(
    cmd: &mut tokio::process::Command,
    launch: Option<&OrchestrationMcpLaunch>,
) {
    match launch {
        Some(launch) => cmd.env(MCP_TOKEN_ENV, launch.token.expose()),
        None => cmd.env_remove(MCP_TOKEN_ENV),
    };
}

#[cfg(test)]
mod tests {
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
}
