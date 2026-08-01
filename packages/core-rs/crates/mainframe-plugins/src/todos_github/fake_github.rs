//! A `GitHubIssues` test double (todo #286) shared by `run_tests.rs` and
//! `pairing_tests.rs`: every call is recorded so a test can assert exactly
//! which issues a run touched, and each method's response is scripted ahead
//! of time per issue number.

use std::collections::HashMap;
use std::sync::Mutex;

use mainframe_adapter_api::BoxFuture;

use crate::github_port::{
    CreateIssue, GitHubIssues, GitHubPortError, IssueFieldTimes, IssuePatch, IssueSnapshot, RepoRef,
};

#[derive(Debug, Clone)]
pub(crate) enum Call {
    ListOpenIssues,
    GetIssue(u64),
    IssueFieldTimes(u64),
    CreateIssue(CreateIssue),
    UpdateIssue(u64, IssuePatch),
}

#[derive(Default)]
pub(crate) struct FakeGitHub {
    pub(crate) calls: Mutex<Vec<Call>>,
    open_issues: Mutex<Vec<IssueSnapshot>>,
    issues: Mutex<HashMap<u64, IssueSnapshot>>,
    field_times: Mutex<HashMap<u64, IssueFieldTimes>>,
    get_errors: Mutex<HashMap<u64, GitHubPortError>>,
    list_error: Mutex<Option<GitHubPortError>>,
    create_error: Mutex<Option<GitHubPortError>>,
    create_result: Mutex<Option<IssueSnapshot>>,
    next_number: Mutex<u64>,
}

impl FakeGitHub {
    pub(crate) fn with_issue(self, issue: IssueSnapshot) -> Self {
        self.issues.lock().unwrap().insert(issue.number, issue);
        self
    }

    pub(crate) fn with_open_issues(self, issues: Vec<IssueSnapshot>) -> Self {
        *self.open_issues.lock().unwrap() = issues;
        self
    }

    pub(crate) fn with_field_times(self, number: u64, times: IssueFieldTimes) -> Self {
        self.field_times.lock().unwrap().insert(number, times);
        self
    }

    pub(crate) fn with_get_error(self, number: u64, error: GitHubPortError) -> Self {
        self.get_errors.lock().unwrap().insert(number, error);
        self
    }

    pub(crate) fn with_list_error(self, error: GitHubPortError) -> Self {
        *self.list_error.lock().unwrap() = Some(error);
        self
    }

    pub(crate) fn with_create_result(self, issue: IssueSnapshot) -> Self {
        *self.next_number.lock().unwrap() = issue.number;
        *self.create_result.lock().unwrap() = Some(issue);
        self
    }

    pub(crate) fn with_create_error(self, error: GitHubPortError) -> Self {
        *self.create_error.lock().unwrap() = Some(error);
        self
    }

    pub(crate) fn call_count(&self) -> usize {
        self.calls.lock().unwrap().len()
    }
}

impl GitHubIssues for FakeGitHub {
    fn list_open_issues(
        &self,
        _repo: &RepoRef,
        _credential_label: &str,
    ) -> BoxFuture<'_, Result<Vec<IssueSnapshot>, GitHubPortError>> {
        self.calls.lock().unwrap().push(Call::ListOpenIssues);
        let error = self.list_error.lock().unwrap().clone();
        let issues = self.open_issues.lock().unwrap().clone();
        Box::pin(async move { error.map(Err).unwrap_or(Ok(issues)) })
    }

    fn get_issue(
        &self,
        _repo: &RepoRef,
        number: u64,
        _credential_label: &str,
    ) -> BoxFuture<'_, Result<IssueSnapshot, GitHubPortError>> {
        self.calls.lock().unwrap().push(Call::GetIssue(number));
        let error = self.get_errors.lock().unwrap().get(&number).cloned();
        let issue = self.issues.lock().unwrap().get(&number).cloned();
        Box::pin(async move {
            if let Some(error) = error {
                return Err(error);
            }
            issue.ok_or(GitHubPortError::NotFound)
        })
    }

    fn issue_field_times(
        &self,
        _repo: &RepoRef,
        number: u64,
        _credential_label: &str,
    ) -> BoxFuture<'_, Result<IssueFieldTimes, GitHubPortError>> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::IssueFieldTimes(number));
        let times = self
            .field_times
            .lock()
            .unwrap()
            .get(&number)
            .cloned()
            .unwrap_or_default();
        Box::pin(async move { Ok(times) })
    }

    fn create_issue(
        &self,
        _repo: &RepoRef,
        input: CreateIssue,
        _credential_label: &str,
    ) -> BoxFuture<'_, Result<IssueSnapshot, GitHubPortError>> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::CreateIssue(input.clone()));
        let error = self.create_error.lock().unwrap().clone();
        let result = self
            .create_result
            .lock()
            .unwrap()
            .clone()
            .unwrap_or(IssueSnapshot {
                number: *self.next_number.lock().unwrap(),
                title: input.title,
                body: input.body,
                labels: input.labels,
                state: crate::github_port::IssueState::Open,
                html_url: String::new(),
                updated_at: String::new(),
            });
        Box::pin(async move { error.map(Err).unwrap_or(Ok(result)) })
    }

    fn update_issue(
        &self,
        _repo: &RepoRef,
        number: u64,
        patch: IssuePatch,
        _credential_label: &str,
    ) -> BoxFuture<'_, Result<IssueSnapshot, GitHubPortError>> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::UpdateIssue(number, patch.clone()));
        let existing = self.issues.lock().unwrap().get(&number).cloned();
        Box::pin(async move {
            let mut issue = existing.ok_or(GitHubPortError::NotFound)?;
            if let Some(title) = patch.title {
                issue.title = title;
            }
            if let Some(body) = patch.body {
                issue.body = body;
            }
            if let Some(labels) = patch.labels {
                issue.labels = labels;
            }
            if let Some(state) = patch.state {
                issue.state = state;
            }
            Ok(issue)
        })
    }
}
