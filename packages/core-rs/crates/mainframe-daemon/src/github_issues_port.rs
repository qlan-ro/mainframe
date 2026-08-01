//! Adapts `mainframe_automations::github_issues::GitHubIssuesClient` to the
//! plugins-crate `GitHubIssues` port (task 4). This is the one place the two
//! independent DTO sets meet — the plugins crate cannot depend on
//! automations (fact 12), so the shapes are mirrored, not shared. The token
//! is read from the credential store on every call, not cached at
//! construction, so a token connected after boot (via the link dialog) works
//! without a daemon restart.

use std::sync::Arc;

use mainframe_automations::credentials::CredentialStore;
use mainframe_automations::github_issues::{self as gh, GitHubIssuesClient};
use mainframe_plugins::{
    BoxFuture, CreateIssue, GitHubIssues, GitHubPortError, IssueFieldTimes, IssuePatch,
    IssueSnapshot, IssueState, RepoRef,
};

pub struct DaemonGitHubIssuesPort {
    client: GitHubIssuesClient,
    credentials: Arc<dyn CredentialStore>,
}

impl DaemonGitHubIssuesPort {
    pub fn new(credentials: Arc<dyn CredentialStore>) -> Result<Self, gh::GitHubError> {
        Ok(Self {
            client: GitHubIssuesClient::new()?,
            credentials,
        })
    }

    #[cfg(test)]
    pub fn with_base_url(
        base_url: impl Into<String>,
        credentials: Arc<dyn CredentialStore>,
    ) -> Result<Self, gh::GitHubError> {
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
        let repo = to_automations_repo(repo);
        let label = credential_label.to_string();
        Box::pin(async move {
            let token = self.token(&label).await?;
            self.client
                .list_open_issues(&repo, &token)
                .await
                .map(|issues| issues.into_iter().map(from_automations_snapshot).collect())
                .map_err(map_error)
        })
    }

    fn get_issue(
        &self,
        repo: &RepoRef,
        number: u64,
        credential_label: &str,
    ) -> BoxFuture<'_, Result<IssueSnapshot, GitHubPortError>> {
        let repo = to_automations_repo(repo);
        let label = credential_label.to_string();
        Box::pin(async move {
            let token = self.token(&label).await?;
            self.client
                .get_issue(&repo, number, &token)
                .await
                .map(from_automations_snapshot)
                .map_err(map_error)
        })
    }

    fn issue_field_times(
        &self,
        repo: &RepoRef,
        number: u64,
        credential_label: &str,
    ) -> BoxFuture<'_, Result<IssueFieldTimes, GitHubPortError>> {
        let repo = to_automations_repo(repo);
        let label = credential_label.to_string();
        Box::pin(async move {
            let token = self.token(&label).await?;
            self.client
                .issue_field_times(&repo, number, &token)
                .await
                .map(|times| IssueFieldTimes {
                    title_at: times.title_at,
                    state_at: times.state_at,
                })
                .map_err(map_error)
        })
    }

    fn create_issue(
        &self,
        repo: &RepoRef,
        input: CreateIssue,
        credential_label: &str,
    ) -> BoxFuture<'_, Result<IssueSnapshot, GitHubPortError>> {
        let repo = to_automations_repo(repo);
        let label = credential_label.to_string();
        let input = gh::CreateIssue {
            title: input.title,
            body: input.body,
            labels: input.labels,
        };
        Box::pin(async move {
            let token = self.token(&label).await?;
            self.client
                .create_issue(&repo, input, &token)
                .await
                .map(from_automations_snapshot)
                .map_err(map_error)
        })
    }

    fn update_issue(
        &self,
        repo: &RepoRef,
        number: u64,
        patch: IssuePatch,
        credential_label: &str,
    ) -> BoxFuture<'_, Result<IssueSnapshot, GitHubPortError>> {
        let repo = to_automations_repo(repo);
        let label = credential_label.to_string();
        let patch = gh::IssuePatch {
            title: patch.title,
            body: patch.body,
            labels: patch.labels,
            state: patch.state.map(to_automations_state),
            state_reason: patch.state_reason,
        };
        Box::pin(async move {
            let token = self.token(&label).await?;
            self.client
                .update_issue(&repo, number, patch, &token)
                .await
                .map(from_automations_snapshot)
                .map_err(map_error)
        })
    }
}

fn to_automations_repo(repo: &RepoRef) -> gh::RepoRef {
    gh::RepoRef {
        owner: repo.owner.clone(),
        repo: repo.repo.clone(),
    }
}

fn to_automations_state(state: IssueState) -> gh::IssueState {
    match state {
        IssueState::Open => gh::IssueState::Open,
        IssueState::Closed => gh::IssueState::Closed,
    }
}

fn from_automations_snapshot(snapshot: gh::IssueSnapshot) -> IssueSnapshot {
    IssueSnapshot {
        number: snapshot.number,
        title: snapshot.title,
        body: snapshot.body,
        labels: snapshot.labels,
        state: match snapshot.state {
            gh::IssueState::Open => IssueState::Open,
            gh::IssueState::Closed => IssueState::Closed,
        },
        html_url: snapshot.html_url,
        updated_at: snapshot.updated_at,
    }
}

fn map_error(err: gh::GitHubError) -> GitHubPortError {
    match err {
        gh::GitHubError::NotFound => GitHubPortError::NotFound,
        gh::GitHubError::Moved => GitHubPortError::Moved,
        gh::GitHubError::Auth(message) => GitHubPortError::Auth(message),
        gh::GitHubError::RateLimited { wait } => GitHubPortError::RateLimited { wait },
        gh::GitHubError::Network(message) => GitHubPortError::Network(message),
        gh::GitHubError::Request { status, message } => {
            GitHubPortError::Request { status, message }
        }
    }
}

// PORT STATUS: (new — production GitHubIssues wiring for the todos-plugin
// sync engine, task 5b)
// confidence: high
// todos: 0
// notes: the credential label is resolved per call via `CredentialStore::get`,
// never cached, so a token connected after boot (link dialog → set_credential)
// resolves without a restart. GitHubError -> GitHubPortError is a 1:1 mapping;
// GitHubPortError::Unavailable is unreachable from this adapter (only the
// plugins-crate guard constructs it).
