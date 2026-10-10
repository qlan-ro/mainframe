//! Adapts the shared GitHub Issues client to the capability-gated plugin port.
//! Credentials are read on every call so a newly connected token works without restart.

use std::sync::Arc;

use mainframe_automations::credentials::CredentialStore;
use mainframe_github::github_issues::GitHubIssuesClient;
use mainframe_plugins::{
    BoxFuture, CreateIssue, GitHubIssues, GitHubPortError, IssueFieldTimes, IssuePatch,
    IssueSnapshot, RepoRef,
};

pub struct DaemonGitHubIssuesPort {
    client: GitHubIssuesClient,
    credentials: Arc<dyn CredentialStore>,
}

impl DaemonGitHubIssuesPort {
    pub fn new(credentials: Arc<dyn CredentialStore>) -> Result<Self, GitHubPortError> {
        Ok(Self {
            client: GitHubIssuesClient::new()?,
            credentials,
        })
    }

    #[cfg(test)]
    pub fn with_base_url(
        base_url: impl Into<String>,
        credentials: Arc<dyn CredentialStore>,
    ) -> Result<Self, GitHubPortError> {
        Ok(Self {
            client: GitHubIssuesClient::with_base_url(base_url)?,
            credentials,
        })
    }

    async fn token(&self, label: &str) -> Result<String, GitHubPortError> {
        self.credentials
            .get(label)
            .await
            .map(|creds| creds.token)
            .ok_or_else(|| {
                GitHubPortError::Auth(format!(
                    "No GitHub credential is stored for '{label}'. Link the repository \
                     again to connect one."
                ))
            })
    }
}

impl GitHubIssues for DaemonGitHubIssuesPort {
    fn list_open_issues(
        &self,
        repo: &RepoRef,
        credential_label: &str,
    ) -> BoxFuture<'_, Result<Vec<IssueSnapshot>, GitHubPortError>> {
        let repo = repo.clone();
        let label = credential_label.to_string();
        Box::pin(async move {
            let token = self.token(&label).await?;
            self.client.list_open_issues(&repo, &token).await
        })
    }

    fn get_issue(
        &self,
        repo: &RepoRef,
        number: u64,
        credential_label: &str,
    ) -> BoxFuture<'_, Result<IssueSnapshot, GitHubPortError>> {
        let repo = repo.clone();
        let label = credential_label.to_string();
        Box::pin(async move {
            let token = self.token(&label).await?;
            self.client.get_issue(&repo, number, &token).await
        })
    }

    fn issue_field_times(
        &self,
        repo: &RepoRef,
        number: u64,
        credential_label: &str,
    ) -> BoxFuture<'_, Result<IssueFieldTimes, GitHubPortError>> {
        let repo = repo.clone();
        let label = credential_label.to_string();
        Box::pin(async move {
            let token = self.token(&label).await?;
            self.client.issue_field_times(&repo, number, &token).await
        })
    }

    fn create_issue(
        &self,
        repo: &RepoRef,
        input: CreateIssue,
        credential_label: &str,
    ) -> BoxFuture<'_, Result<IssueSnapshot, GitHubPortError>> {
        let repo = repo.clone();
        let label = credential_label.to_string();
        Box::pin(async move {
            let token = self.token(&label).await?;
            self.client.create_issue(&repo, input, &token).await
        })
    }

    fn update_issue(
        &self,
        repo: &RepoRef,
        number: u64,
        patch: IssuePatch,
        credential_label: &str,
    ) -> BoxFuture<'_, Result<IssueSnapshot, GitHubPortError>> {
        let repo = repo.clone();
        let label = credential_label.to_string();
        Box::pin(async move {
            let token = self.token(&label).await?;
            self.client.update_issue(&repo, number, patch, &token).await
        })
    }
}
