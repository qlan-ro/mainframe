//! `GuardGitHub` — the GitHub port stand-in when `http:outbound` is
//! undeclared, or when it is declared but the daemon's automations engine
//! never started (D2). Fails every method with the reason it was built for —
//! never panics, never reaches the network. Split out of `context.rs`'s
//! `guards` module to keep new code out of an already-oversized file.

use crate::PluginError;
use crate::github_port::{
    CreateIssue, GitHubIssues, GitHubPortError, IssueFieldTimes, IssuePatch, IssueSnapshot, RepoRef,
};
use mainframe_adapter_api::BoxFuture;

pub struct GuardGitHub {
    reason: String,
}

impl GuardGitHub {
    pub fn capability_missing() -> Self {
        Self {
            reason: PluginError::CapabilityRequired("http:outbound".to_string()).to_string(),
        }
    }

    pub fn engine_unavailable() -> Self {
        Self {
            reason: "GitHub sync is unavailable: the automations engine did not start, \
                     so no credential store is available."
                .to_string(),
        }
    }

    fn err(&self) -> GitHubPortError {
        GitHubPortError::Unavailable(self.reason.clone())
    }
}

impl GitHubIssues for GuardGitHub {
    fn list_open_issues(
        &self,
        _repo: &RepoRef,
        _credential_label: &str,
    ) -> BoxFuture<'_, Result<Vec<IssueSnapshot>, GitHubPortError>> {
        Box::pin(async { Err(self.err()) })
    }

    fn get_issue(
        &self,
        _repo: &RepoRef,
        _number: u64,
        _credential_label: &str,
    ) -> BoxFuture<'_, Result<IssueSnapshot, GitHubPortError>> {
        Box::pin(async { Err(self.err()) })
    }

    fn issue_field_times(
        &self,
        _repo: &RepoRef,
        _number: u64,
        _credential_label: &str,
    ) -> BoxFuture<'_, Result<IssueFieldTimes, GitHubPortError>> {
        Box::pin(async { Err(self.err()) })
    }

    fn create_issue(
        &self,
        _repo: &RepoRef,
        _input: CreateIssue,
        _credential_label: &str,
    ) -> BoxFuture<'_, Result<IssueSnapshot, GitHubPortError>> {
        Box::pin(async { Err(self.err()) })
    }

    fn update_issue(
        &self,
        _repo: &RepoRef,
        _number: u64,
        _patch: IssuePatch,
        _credential_label: &str,
    ) -> BoxFuture<'_, Result<IssueSnapshot, GitHubPortError>> {
        Box::pin(async { Err(self.err()) })
    }
}
