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
#[path = "orchestration_args_tests.rs"]
mod tests;
