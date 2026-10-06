//! Agent orchestration over MCP: the per-spawn credential an adapter injects
//! into its CLI, and the delegated-task records the `mainframe` MCP server
//! keeps (spec `docs/specs/2026-10-06-mcp-orchestration-server.md`).

use std::fmt;

use serde::{Deserialize, Serialize};

/// The env var both adapters put the raw bearer token in. Claude expands it
/// inside `--mcp-config` headers and Codex reads it through
/// `bearer_token_env_var`, so the token never lands in argv (which any local
/// user can read from `/proc/<pid>/cmdline`).
pub const MCP_TOKEN_ENV: &str = "MAINFRAME_MCP_TOKEN";

/// The MCP server key, so Claude names the tools `mcp__mainframe__<tool>`.
pub const MCP_SERVER_NAME: &str = "mainframe";

/// Per-call timeout handed to the CLI, above the server's 60-minute wait cap so
/// Mainframe's own timeout decides when a blocking call returns.
pub const MCP_CLIENT_TIMEOUT_MS: u64 = 3_900_000;

/// A raw bearer token. `Debug` and `Display` never print it, so a stray
/// `?options` in a log line cannot leak it.
#[derive(Clone, PartialEq, Eq)]
pub struct SecretToken(String);

impl SecretToken {
    #[must_use]
    pub fn new(raw: String) -> Self {
        Self(raw)
    }

    /// The raw value, for the one place that needs it: the child's environment.
    #[must_use]
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for SecretToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("***")
    }
}

/// What an adapter needs to give its CLI the orchestration tools: the
/// loopback endpoint and this spawn's credential.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrchestrationMcpLaunch {
    pub url: String,
    pub token: SecretToken,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Queued,
    Running,
    Waiting,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

impl TaskStatus {
    #[must_use]
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Failed | Self::Cancelled | Self::Interrupted
        )
    }

    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Waiting => "waiting",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Interrupted => "interrupted",
        }
    }

    #[must_use]
    pub fn parse(raw: &str) -> Option<Self> {
        Some(match raw {
            "queued" => Self::Queued,
            "running" => Self::Running,
            "waiting" => Self::Waiting,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "cancelled" => Self::Cancelled,
            "interrupted" => Self::Interrupted,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskWorkState {
    Working,
    WaitingForChildren,
    ResultAvailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskRole {
    Implementation,
    Research,
    Review,
    Design,
    Test,
    General,
}

impl TaskRole {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Implementation => "implementation",
            Self::Research => "research",
            Self::Review => "review",
            Self::Design => "design",
            Self::Test => "test",
            Self::General => "general",
        }
    }

    #[must_use]
    pub fn parse(raw: &str) -> Option<Self> {
        Some(match raw {
            "implementation" => Self::Implementation,
            "research" => Self::Research,
            "review" => Self::Review,
            "design" => Self::Design,
            "test" => Self::Test,
            "general" => Self::General,
            _ => return None,
        })
    }
}

/// Where the parent's completion delivery stands. `Owed` survives a restart;
/// `Acknowledged` means the parent already read the result through a tool.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskDelivery {
    Pending,
    Owed,
    Delivered,
    Acknowledged,
    Dropped,
}

impl TaskDelivery {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Owed => "owed",
            Self::Delivered => "delivered",
            Self::Acknowledged => "acknowledged",
            Self::Dropped => "dropped",
        }
    }

    #[must_use]
    pub fn parse(raw: &str) -> Option<Self> {
        Some(match raw {
            "pending" => Self::Pending,
            "owed" => Self::Owed,
            "delivered" => Self::Delivered,
            "acknowledged" => Self::Acknowledged,
            "dropped" => Self::Dropped,
            _ => return None,
        })
    }
}

/// One `delegated_tasks` row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegatedTask {
    pub id: String,
    pub parent_chat_id: String,
    pub child_chat_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub role: TaskRole,
    pub status: TaskStatus,
    pub depth: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancel_reason: Option<String>,
    pub delivery: TaskDelivery,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_token_debug_never_prints_the_value() {
        let launch = OrchestrationMcpLaunch {
            url: "http://127.0.0.1:1/mcp".into(),
            token: SecretToken::new("raw-secret".into()),
        };
        let printed = format!("{launch:?}");
        assert!(!printed.contains("raw-secret"));
        assert!(printed.contains("***"));
    }

    #[test]
    fn status_round_trips_and_classifies_terminal() {
        for status in [
            TaskStatus::Queued,
            TaskStatus::Running,
            TaskStatus::Waiting,
            TaskStatus::Completed,
            TaskStatus::Failed,
            TaskStatus::Cancelled,
            TaskStatus::Interrupted,
        ] {
            assert_eq!(TaskStatus::parse(status.as_str()), Some(status));
        }
        assert!(!TaskStatus::Waiting.is_terminal());
        assert!(TaskStatus::Interrupted.is_terminal());
    }
}
