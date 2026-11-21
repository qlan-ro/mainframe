//! Read/write client for GitHub Issues (todos-plugin sync). Every call takes
//! the bearer token; the client holds no credentials. Redirects are not
//! followed: a transferred issue answers one, and following it would re-point
//! a pair at another repository, so callers get `GitHubError::Moved`.

mod types;

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::header::{HeaderMap, LINK, RETRY_AFTER};
use reqwest::{Method, RequestBuilder, Response, StatusCode, Url};
use serde::de::DeserializeOwned;

use crate::rest::{GITHUB_API, REQUEST_TIMEOUT, client_builder, github_request, snippet};
use types::{RawIssue, TimelineEvent};

pub use types::{
    CreateIssue, GitHubError, IssueFieldTimes, IssuePatch, IssueSnapshot, IssueState, RepoRef,
};

/// Pages one listing may follow (100 items each). Only a `Link` header that
/// never stops reaches it.
const MAX_PAGES: usize = 1000;

/// GitHub's advice for a secondary rate limit that names no wait: "wait for
/// at least one minute before retrying".
const SECONDARY_LIMIT_WAIT: Duration = Duration::from_secs(60);

pub struct GitHubIssuesClient {
    /// Base URL without a trailing slash, for formatting request paths.
    base: String,
    /// The same URL parsed, so pagination links can be checked against its origin.
    base_url: Url,
    http: reqwest::Client,
    timeout: Duration,
}

impl GitHubIssuesClient {
    pub fn new() -> Result<Self, GitHubError> {
        Self::with_base_url(GITHUB_API)
    }

    /// Fallible because a client without `redirect::Policy::none()` would
    /// follow transfers. The composition root leaves the GitHub port unwired
    /// on error.
    pub fn with_base_url(base_url: impl Into<String>) -> Result<Self, GitHubError> {
        let base = base_url.into().trim_end_matches('/').to_string();
        let parsed = Url::parse(&base).map_err(|err| {
            GitHubError::Unavailable(format!("invalid GitHub API URL {base:?}: {err}"))
        })?;
        let http = client_builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|err| GitHubError::Network(err.to_string()))?;
        Ok(Self {
            base,
            base_url: parsed,
            http,
            timeout: REQUEST_TIMEOUT,
        })
    }

    #[cfg(test)]
    fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    pub async fn list_open_issues(
        &self,
        repo: &RepoRef,
        token: &str,
    ) -> Result<Vec<IssueSnapshot>, GitHubError> {
        let url = self.repo_url(repo, "/issues?state=open&per_page=100&page=1");
        let issues: Vec<RawIssue> = self.get_all_pages(url, token).await?;
        // The issues endpoint returns pull requests too. A PR paired with a
        // task would sync task edits into the PR, so drop them.
        Ok(issues
            .into_iter()
            .filter(|raw| !raw.is_pull_request())
            .map(IssueSnapshot::from)
            .collect())
    }

    pub async fn get_issue(
        &self,
        repo: &RepoRef,
        number: u64,
        token: &str,
    ) -> Result<IssueSnapshot, GitHubError> {
        let url = self.repo_url(repo, &format!("/issues/{number}"));
        let response = self.send(self.request(Method::GET, &url, token)).await?;
        Ok(parse_body::<RawIssue>(response).await?.into())
    }

    pub async fn issue_field_times(
        &self,
        repo: &RepoRef,
        number: u64,
        token: &str,
    ) -> Result<IssueFieldTimes, GitHubError> {
        let url = self.repo_url(
            repo,
            &format!("/issues/{number}/timeline?per_page=100&page=1"),
        );
        let events: Vec<TimelineEvent> = self.get_all_pages(url, token).await?;
        // The timeline is oldest first, so the last matching event is the newest.
        let last = |matches: fn(&str) -> bool| {
            events
                .iter()
                .rev()
                .find(|event| matches(&event.event))
                .and_then(|event| event.created_at.clone())
        };
        Ok(IssueFieldTimes {
            title_at: last(|event| event == "renamed"),
            state_at: last(|event| event == "closed" || event == "reopened"),
        })
    }

    pub async fn create_issue(
        &self,
        repo: &RepoRef,
        input: CreateIssue,
        token: &str,
    ) -> Result<IssueSnapshot, GitHubError> {
        let url = self.repo_url(repo, "/issues");
        let request = self.request(Method::POST, &url, token).json(&input);
        let response = self.send(request).await?;
        Ok(parse_body::<RawIssue>(response).await?.into())
    }

    pub async fn update_issue(
        &self,
        repo: &RepoRef,
        number: u64,
        patch: IssuePatch,
        token: &str,
    ) -> Result<IssueSnapshot, GitHubError> {
        let url = self.repo_url(repo, &format!("/issues/{number}"));
        let request = self.request(Method::PATCH, &url, token).json(&patch);
        let response = self.send(request).await?;
        Ok(parse_body::<RawIssue>(response).await?.into())
    }

    fn repo_url(&self, repo: &RepoRef, path: &str) -> String {
        format!("{}/repos/{}/{}{path}", self.base, repo.owner, repo.repo)
    }

    fn request(&self, method: Method, url: &str, token: &str) -> RequestBuilder {
        github_request(self.http.request(method, url))
            .bearer_auth(token)
            .timeout(self.timeout)
    }

    async fn send(&self, request: RequestBuilder) -> Result<Response, GitHubError> {
        let response = request
            .send()
            .await
            .map_err(|err| GitHubError::Network(err.to_string()))?;
        check_status(response).await
    }

    /// Follows `Link: rel="next"` until the last page. Each link must stay on
    /// the API origin, because the bearer token goes with every request.
    async fn get_all_pages<T: DeserializeOwned>(
        &self,
        first: String,
        token: &str,
    ) -> Result<Vec<T>, GitHubError> {
        let mut url = first;
        let mut items = Vec::new();
        for _ in 0..MAX_PAGES {
            let response = self.send(self.request(Method::GET, &url, token)).await?;
            let next = next_page_url(response.headers());
            items.extend(parse_body::<Vec<T>>(response).await?);
            match next {
                Some(next) => url = self.same_origin(next)?,
                None => return Ok(items),
            }
        }
        Err(GitHubError::UnexpectedResponse(format!(
            "pagination did not end after {MAX_PAGES} pages"
        )))
    }

    fn same_origin(&self, link: String) -> Result<String, GitHubError> {
        match Url::parse(&link) {
            Ok(url) if url.origin() == self.base_url.origin() => Ok(link),
            _ => Err(GitHubError::UnexpectedResponse(format!(
                "pagination link {link:?} is not on {}",
                self.base
            ))),
        }
    }
}

async fn parse_body<T: DeserializeOwned>(response: Response) -> Result<T, GitHubError> {
    let bytes = response
        .bytes()
        .await
        .map_err(|err| GitHubError::Network(err.to_string()))?;
    serde_json::from_slice(&bytes).map_err(|err| GitHubError::UnexpectedResponse(err.to_string()))
}

async fn check_status(response: Response) -> Result<Response, GitHubError> {
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
    let headers = response.headers().clone();
    let body = response.text().await.unwrap_or_default();
    if is_rate_limited(status, &headers, &body) {
        return Err(GitHubError::RateLimited {
            wait: Some(rate_limit_wait(&headers)),
        });
    }
    let message = snippet(&body);
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return Err(GitHubError::Auth(message));
    }
    Err(GitHubError::Request {
        status: status.as_u16(),
        message,
    })
}

/// GitHub answers both limits with 403 or 429. A 403 is a rate limit only
/// with `Retry-After`, an exhausted primary budget, or a secondary-limit
/// message (the check octokit's throttling plugin uses); any other 403 is
/// an auth failure.
fn is_rate_limited(status: StatusCode, headers: &HeaderMap, body: &str) -> bool {
    if status == StatusCode::TOO_MANY_REQUESTS {
        return true;
    }
    status == StatusCode::FORBIDDEN
        && (headers.contains_key(RETRY_AFTER)
            || rate_limit_remaining_is_zero(headers)
            || body.to_ascii_lowercase().contains("secondary rate limit"))
}

/// GitHub's order: `Retry-After` if present, else the primary reset time if
/// the budget is spent, else at least a minute.
fn rate_limit_wait(headers: &HeaderMap) -> Duration {
    retry_after(headers)
        .or_else(|| {
            rate_limit_remaining_is_zero(headers)
                .then(|| rate_limit_reset_wait(headers))
                .flatten()
        })
        .unwrap_or(SECONDARY_LIMIT_WAIT)
}

fn header_u64(headers: &HeaderMap, name: impl reqwest::header::AsHeaderName) -> Option<u64> {
    headers.get(name)?.to_str().ok()?.parse().ok()
}

fn retry_after(headers: &HeaderMap) -> Option<Duration> {
    header_u64(headers, RETRY_AFTER).map(Duration::from_secs)
}

fn rate_limit_remaining_is_zero(headers: &HeaderMap) -> bool {
    header_u64(headers, "x-ratelimit-remaining") == Some(0)
}

fn rate_limit_reset_wait(headers: &HeaderMap) -> Option<Duration> {
    let reset = header_u64(headers, "x-ratelimit-reset")?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
    Some(Duration::from_secs(reset.saturating_sub(now)))
}

fn next_page_url(headers: &HeaderMap) -> Option<String> {
    let link = headers.get(LINK)?.to_str().ok()?;
    link.split(',').find_map(|entry| {
        let (target, params) = entry.split_once(';')?;
        let is_next = params
            .split(';')
            .any(|param| param.trim() == r#"rel="next""#);
        let url = target.trim().strip_prefix('<')?.strip_suffix('>')?;
        is_next.then(|| url.to_string())
    })
}

#[cfg(test)]
#[path = "issues_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "issues_errors_tests.rs"]
mod errors_tests;
