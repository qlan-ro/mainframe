//! The Issues client's read model, write inputs, the wire shapes GitHub
//! returns, and the error taxonomy callers match on.

use std::time::Duration;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoRef {
    pub owner: String,
    pub repo: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
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

/// When the title and the open/closed state last changed, read from the
/// issue timeline. `None` when that change never happened.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IssueFieldTimes {
    pub title_at: Option<String>,
    pub state_at: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct CreateIssue {
    pub title: String,
    pub body: String,
    pub labels: Vec<String>,
}

/// Fields to change; `None` leaves a field as it is on GitHub.
#[derive(Debug, Clone, Default, Serialize)]
pub struct IssuePatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub labels: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<IssueState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GitHubError {
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
    /// A successful status with a body or headers the client cannot use.
    #[error("unexpected response from GitHub: {0}")]
    UnexpectedResponse(String),
    #[error("{0}")]
    Unavailable(String),
}

#[derive(Deserialize)]
struct RawLabel {
    name: String,
}

#[derive(Deserialize)]
pub(super) struct RawIssue {
    number: u64,
    title: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    labels: Vec<RawLabel>,
    state: IssueState,
    html_url: String,
    updated_at: String,
    /// The issues endpoints return pull requests too, marked by this key.
    #[serde(default)]
    pull_request: Option<serde::de::IgnoredAny>,
}

impl RawIssue {
    pub(super) fn is_pull_request(&self) -> bool {
        self.pull_request.is_some()
    }
}

impl From<RawIssue> for IssueSnapshot {
    fn from(raw: RawIssue) -> Self {
        Self {
            number: raw.number,
            title: raw.title,
            body: raw.body.unwrap_or_default(),
            labels: raw.labels.into_iter().map(|label| label.name).collect(),
            state: raw.state,
            html_url: raw.html_url,
            updated_at: raw.updated_at,
        }
    }
}

#[derive(Deserialize)]
pub(super) struct TimelineEvent {
    pub(super) event: String,
    #[serde(default)]
    pub(super) created_at: Option<String>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{IssuePatch, IssueState};

    #[test]
    fn issue_patch_serializes_only_the_given_github_fields() {
        let full = IssuePatch {
            title: Some("Fix sync".into()),
            body: Some("Details".into()),
            labels: Some(vec!["bug".into()]),
            state: Some(IssueState::Closed),
            state_reason: Some("completed".into()),
        };
        assert_eq!(
            serde_json::to_value(full).unwrap(),
            json!({
                "title": "Fix sync",
                "body": "Details",
                "labels": ["bug"],
                "state": "closed",
                "state_reason": "completed",
            })
        );
        let reopen = IssuePatch {
            state: Some(IssueState::Open),
            ..IssuePatch::default()
        };
        assert_eq!(
            serde_json::to_value(reopen).unwrap(),
            json!({ "state": "open" })
        );
    }
}
