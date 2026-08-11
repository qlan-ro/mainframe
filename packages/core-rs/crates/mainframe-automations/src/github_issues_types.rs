//! DTOs for the GitHub Issues client (todos-plugin GitHub sync, D1): the
//! domain-shaped read model (`IssueSnapshot`, `IssueFieldTimes`), the write
//! inputs (`CreateIssue`, `IssuePatch`), the wire-shaped `Raw*` structs GitHub
//! actually returns, and the failure taxonomy (`GitHubError`) callers match on.

use std::time::Duration;

use serde::Deserialize;
use serde_json::{Value, json};

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

/// Per-family timestamps read from the issue timeline — `None` when the
/// family's event (a title rename, or a close/reopen) never happened.
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
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawLabel {
    name: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawIssue {
    number: u64,
    title: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    labels: Vec<RawLabel>,
    state: String,
    html_url: String,
    updated_at: String,
    // GitHub's issues endpoints return pull requests too, marked by this key.
    #[serde(default)]
    pull_request: Option<serde::de::IgnoredAny>,
}

impl RawIssue {
    pub(crate) fn is_pull_request(&self) -> bool {
        self.pull_request.is_some()
    }
}

impl From<RawIssue> for IssueSnapshot {
    fn from(raw: RawIssue) -> Self {
        IssueSnapshot {
            number: raw.number,
            title: raw.title,
            body: raw.body.unwrap_or_default(),
            labels: raw.labels.into_iter().map(|label| label.name).collect(),
            state: if raw.state == "closed" {
                IssueState::Closed
            } else {
                IssueState::Open
            },
            html_url: raw.html_url,
            updated_at: raw.updated_at,
        }
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct TimelineEvent {
    pub(crate) event: String,
    #[serde(default)]
    pub(crate) created_at: Option<String>,
}

pub(crate) fn patch_body(patch: IssuePatch) -> Value {
    let mut body = serde_json::Map::new();
    if let Some(title) = patch.title {
        body.insert("title".to_string(), json!(title));
    }
    if let Some(text) = patch.body {
        body.insert("body".to_string(), json!(text));
    }
    if let Some(labels) = patch.labels {
        body.insert("labels".to_string(), json!(labels));
    }
    if let Some(state) = patch.state {
        let state = match state {
            IssueState::Open => "open",
            IssueState::Closed => "closed",
        };
        body.insert("state".to_string(), json!(state));
    }
    if let Some(reason) = patch.state_reason {
        body.insert("state_reason".to_string(), json!(reason));
    }
    Value::Object(body)
}
