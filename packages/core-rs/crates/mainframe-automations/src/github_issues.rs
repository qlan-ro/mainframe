//! Read/write client for GitHub Issues (todos-plugin GitHub sync, D1). Every
//! call takes the bearer token explicitly — this module holds no credential
//! store, so its lifetime is independent of `PluginContext`. Built with
//! `redirect::Policy::none()` (D6): a transferred issue answers a redirect,
//! and following it would silently re-point a pair at a different
//! repository, so callers see `GitHubError::Moved` instead.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::{RequestBuilder, StatusCode, header::HeaderMap};
use serde::de::DeserializeOwned;
use serde_json::json;

use crate::USER_AGENT;
use crate::github_http::{GITHUB_API, github_headers};
use crate::github_issues_types::{RawIssue, TimelineEvent, patch_body};

pub use crate::github_issues_types::{
    CreateIssue, GitHubError, IssueFieldTimes, IssuePatch, IssueSnapshot, IssueState, RepoRef,
};

const ERROR_BODY_SNIPPET_CHARS: usize = 500;

pub struct GitHubIssuesClient {
    base_url: String,
    http: reqwest::Client,
}

impl GitHubIssuesClient {
    pub fn new() -> Result<Self, GitHubError> {
        Self::with_base_url(GITHUB_API)
    }

    /// Fallible because `build()` errs on TLS backend init failure, and a
    /// fallback client without `redirect::Policy::none()` would silently
    /// break D6. The composition root answers the error by leaving the
    /// GitHub port unwired, as it already does for a dead automations engine.
    pub fn with_base_url(base_url: impl Into<String>) -> Result<Self, GitHubError> {
        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|err| GitHubError::Network(err.to_string()))?;
        Ok(Self {
            base_url: base_url.into(),
            http,
        })
    }

    fn request(&self, method: reqwest::Method, url: String, token: &str) -> RequestBuilder {
        github_headers(self.http.request(method, url)).bearer_auth(token)
    }

    async fn send(&self, request: RequestBuilder) -> Result<reqwest::Response, GitHubError> {
        request
            .send()
            .await
            .map_err(|err| GitHubError::Network(err.to_string()))
    }

    pub async fn list_open_issues(
        &self,
        repo: &RepoRef,
        token: &str,
    ) -> Result<Vec<IssueSnapshot>, GitHubError> {
        let mut url = format!(
            "{}/repos/{}/{}/issues?state=open&per_page=100&page=1",
            self.base_url, repo.owner, repo.repo
        );
        let mut issues = Vec::new();
        loop {
            let request = self.request(reqwest::Method::GET, url, token);
            let response = check_status(self.send(request).await?).await?;
            let next = next_page_url(response.headers());
            let page: Vec<RawIssue> = parse_body(response).await?;
            // The issues endpoint returns pull requests too — a PR paired
            // with a task would sync task edits into the PR, so drop them.
            issues.extend(
                page.into_iter()
                    .filter(|raw| !raw.is_pull_request())
                    .map(IssueSnapshot::from),
            );
            match next {
                Some(next_url) => url = next_url,
                None => break,
            }
        }
        Ok(issues)
    }

    pub async fn get_issue(
        &self,
        repo: &RepoRef,
        number: u64,
        token: &str,
    ) -> Result<IssueSnapshot, GitHubError> {
        let url = format!(
            "{}/repos/{}/{}/issues/{number}",
            self.base_url, repo.owner, repo.repo
        );
        let request = self.request(reqwest::Method::GET, url, token);
        let response = check_status(self.send(request).await?).await?;
        Ok(parse_body::<RawIssue>(response).await?.into())
    }

    pub async fn issue_field_times(
        &self,
        repo: &RepoRef,
        number: u64,
        token: &str,
    ) -> Result<IssueFieldTimes, GitHubError> {
        let mut url = format!(
            "{}/repos/{}/{}/issues/{number}/timeline?per_page=100&page=1",
            self.base_url, repo.owner, repo.repo
        );
        let mut events = Vec::new();
        loop {
            let request = self.request(reqwest::Method::GET, url, token);
            let response = check_status(self.send(request).await?).await?;
            let next = next_page_url(response.headers());
            let page: Vec<TimelineEvent> = parse_body(response).await?;
            events.extend(page);
            match next {
                Some(next_url) => url = next_url,
                None => break,
            }
        }
        let title_at = events
            .iter()
            .rev()
            .find(|event| event.event == "renamed")
            .and_then(|event| event.created_at.clone());
        let state_at = events
            .iter()
            .rev()
            .find(|event| event.event == "closed" || event.event == "reopened")
            .and_then(|event| event.created_at.clone());
        Ok(IssueFieldTimes { title_at, state_at })
    }

    pub async fn create_issue(
        &self,
        repo: &RepoRef,
        input: CreateIssue,
        token: &str,
    ) -> Result<IssueSnapshot, GitHubError> {
        let url = format!(
            "{}/repos/{}/{}/issues",
            self.base_url, repo.owner, repo.repo
        );
        let body = json!({ "title": input.title, "body": input.body, "labels": input.labels });
        let request = self.request(reqwest::Method::POST, url, token).json(&body);
        let response = check_status(self.send(request).await?).await?;
        Ok(parse_body::<RawIssue>(response).await?.into())
    }

    pub async fn update_issue(
        &self,
        repo: &RepoRef,
        number: u64,
        patch: IssuePatch,
        token: &str,
    ) -> Result<IssueSnapshot, GitHubError> {
        let url = format!(
            "{}/repos/{}/{}/issues/{number}",
            self.base_url, repo.owner, repo.repo
        );
        let body = patch_body(patch);
        let request = self.request(reqwest::Method::PATCH, url, token).json(&body);
        let response = check_status(self.send(request).await?).await?;
        Ok(parse_body::<RawIssue>(response).await?.into())
    }
}

async fn parse_body<T: DeserializeOwned>(response: reqwest::Response) -> Result<T, GitHubError> {
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|err| GitHubError::Network(err.to_string()))?;
    serde_json::from_str(&body).map_err(|err| GitHubError::Request {
        status,
        message: format!("unexpected response: {err}"),
    })
}

async fn check_status(response: reqwest::Response) -> Result<reqwest::Response, GitHubError> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    if status.is_redirection() {
        return Err(GitHubError::Moved);
    }
    if status == StatusCode::NOT_FOUND {
        return Err(GitHubError::NotFound);
    }
    if status == StatusCode::FORBIDDEN
        && let Some(wait) = retry_after(response.headers())
    {
        return Err(GitHubError::RateLimited { wait: Some(wait) });
    }
    // GitHub's primary rate limit answers 403 with `x-ratelimit-remaining: 0`
    // and no `Retry-After` — only the secondary limit sends `Retry-After`.
    // Left unchecked, this falls through to `Auth` below and tells the user
    // their credentials are bad when the account is simply out of budget.
    if status == StatusCode::FORBIDDEN && rate_limit_remaining_is_zero(response.headers()) {
        return Err(GitHubError::RateLimited {
            wait: rate_limit_reset_wait(response.headers()),
        });
    }
    if status == StatusCode::TOO_MANY_REQUESTS {
        return Err(GitHubError::RateLimited {
            wait: rate_limit_reset_wait(response.headers()),
        });
    }
    let message = snippet(&response.text().await.unwrap_or_default());
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return Err(GitHubError::Auth(message));
    }
    Err(GitHubError::Request {
        status: status.as_u16(),
        message,
    })
}

fn snippet(body: &str) -> String {
    body.chars().take(ERROR_BODY_SNIPPET_CHARS).collect()
}

fn retry_after(headers: &HeaderMap) -> Option<Duration> {
    headers
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .parse::<u64>()
        .ok()
        .map(Duration::from_secs)
}

fn rate_limit_remaining_is_zero(headers: &HeaderMap) -> bool {
    headers
        .get("x-ratelimit-remaining")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        == Some(0)
}

fn rate_limit_reset_wait(headers: &HeaderMap) -> Option<Duration> {
    let reset: u64 = headers
        .get("x-ratelimit-reset")?
        .to_str()
        .ok()?
        .parse()
        .ok()?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
    Some(Duration::from_secs(reset.saturating_sub(now)))
}

fn next_page_url(headers: &HeaderMap) -> Option<String> {
    let link = headers.get(reqwest::header::LINK)?.to_str().ok()?;
    link.split(',').find_map(|entry| {
        let (url_part, rel_part) = entry.trim().split_once(';')?;
        if rel_part.trim() == "rel=\"next\"" {
            Some(
                url_part
                    .trim()
                    .trim_start_matches('<')
                    .trim_end_matches('>')
                    .to_string(),
            )
        } else {
            None
        }
    })
}
