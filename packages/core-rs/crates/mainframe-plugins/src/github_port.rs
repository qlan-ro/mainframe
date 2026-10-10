//! Capability-gated GitHub Issues port used by the todos plugin.
//! Every method takes a credential label, leaving tokens with the credential store.

use mainframe_adapter_api::BoxFuture;
pub use mainframe_github::github_issues::{
    CreateIssue, GitHubError as GitHubPortError, IssueFieldTimes, IssuePatch, IssueSnapshot,
    IssueState, RepoRef,
};

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
