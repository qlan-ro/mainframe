//! The GitHub Issues port `PluginContext` exposes to the todos plugin (D1).
//! This crate depends on neither `mainframe-automations` nor `mainframe-git`
//! (fact 12), so the DTOs mirror `mainframe_automations::github_issues`
//! rather than importing it — the daemon's adapter (composition root) is the
//! only place the two shapes meet. Every method takes a credential label, not
//! a token: the port never sees a secret, only the automations engine's
//! credential store does.

use std::time::Duration;

use mainframe_adapter_api::BoxFuture;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoRef {
    pub owner: String,
    pub repo: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueState {
    Open,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IssueSnapshot {
    pub number: u64,
    pub title: String,
    pub body: String,
    pub labels: Vec<String>,
    pub state: IssueState,
    pub html_url: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IssueFieldTimes {
    pub title_at: Option<String>,
    pub state_at: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct CreateIssue {
    pub title: String,
    pub body: String,
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct IssuePatch {
    pub title: Option<String>,
    pub body: Option<String>,
    pub labels: Option<Vec<String>>,
    pub state: Option<IssueState>,
    pub state_reason: Option<String>,
}

/// The failure taxonomy the todos-plugin sync engine matches on, plus a
/// catch-all `Unavailable` for the two guard reasons (D2, fact 10): those
/// carry pre-formatted text rather than a structured cause because they name
/// a configuration problem, not a GitHub API response.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GitHubPortError {
    #[error("not found")]
    NotFound,
    #[error("the resource moved to a different location")]
    Moved,
    #[error("authentication failed: {0}")]
    Auth(String),
    #[error("rate limited{}", .wait.map(|w| format!(", retry after {}s", w.as_secs())).unwrap_or_default())]
    RateLimited { wait: Option<Duration> },
    #[error("network error: {0}")]
    Network(String),
    #[error("request failed ({status}): {message}")]
    Request { status: u16, message: String },
    #[error("{0}")]
    Unavailable(String),
}

/// Read/write GitHub Issues surface, gated on the `http:outbound` capability.
pub trait GitHubIssues: Send + Sync {
    fn list_open_issues(
        &self,
        repo: &RepoRef,
        credential_label: &str,
    ) -> BoxFuture<'_, Result<Vec<IssueSnapshot>, GitHubPortError>>;

    fn get_issue(
        &self,
        repo: &RepoRef,
        number: u64,
        credential_label: &str,
    ) -> BoxFuture<'_, Result<IssueSnapshot, GitHubPortError>>;

    fn issue_field_times(
        &self,
        repo: &RepoRef,
        number: u64,
        credential_label: &str,
    ) -> BoxFuture<'_, Result<IssueFieldTimes, GitHubPortError>>;

    fn create_issue(
        &self,
        repo: &RepoRef,
        input: CreateIssue,
        credential_label: &str,
    ) -> BoxFuture<'_, Result<IssueSnapshot, GitHubPortError>>;

    fn update_issue(
        &self,
        repo: &RepoRef,
        number: u64,
        patch: IssuePatch,
        credential_label: &str,
    ) -> BoxFuture<'_, Result<IssueSnapshot, GitHubPortError>>;
}
