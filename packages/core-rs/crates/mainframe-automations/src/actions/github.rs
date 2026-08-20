//! github connector (T7.1, moved off the `gh` CLI onto REST by the
//! 2026-08-19 provider-connections plan): a bearer token stored under the
//! `github` credential label, same shape as `notion`/`ado`. Params arrive
//! pre-rendered plain strings — the run_action executor renders ChipText
//! before invoking any action other than run_command. `github.create_pr`
//! lives here; `github.list_prs` is `github_list_prs.rs` (split to stay
//! under the file line cap, sharing `parse_json` from here).

use serde::Deserialize;
use serde_json::{Value, json};

use crate::engine::BoxFuture;
use crate::github_http::{GITHUB_API, github_headers};
use crate::tokens::TokenValue;

use super::manifest::{
    ActionAuth, ActionField, ActionGroup, ActionManifest, ActionOutput, ActionOutputType,
};
use super::{Action, ActionCtx, ActionError, ActionOutputs, http_failure, parse_input};

mod github_list_prs;
pub use github_list_prs::GithubListPrsAction;

pub(super) fn parse_json<T: serde::de::DeserializeOwned>(
    body: &str,
    op: &str,
) -> Result<T, ActionError> {
    serde_json::from_str(body)
        .map_err(|err| ActionError(format!("{op} failed: unexpected response ({err})")))
}

/// A GitHub App must be INSTALLED on a repo/org, not just authorized — a
/// user can finish device flow and still get a bare 404 from every repo
/// endpoint if installation never happened. A 404 against a GitHub-App-
/// issued token (`expires_at` set — a pasted PAT has no such concept) is
/// mapped to this actionable message instead of the generic `http_failure`;
/// a real "repo doesn't exist" 404 reads identically from the HTTP layer,
/// but "app not installed" is by far the likelier cause for a token this
/// connector itself just minted.
fn not_installed_error(op: &str, repo: &str) -> ActionError {
    let org = repo.split('/').next().unwrap_or(repo);
    ActionError(format!(
        "{op} failed: Mainframe isn't installed on '{org}' — install it at https://github.com/settings/installations"
    ))
}

fn is_app_issued(ctx: &ActionCtx) -> bool {
    ctx.creds
        .as_ref()
        .is_some_and(|creds| creds.expires_at.is_some())
}

/// `owner/repo`, the only shape a `/repos/<repo>/…` path segment can take.
/// Rejecting anything else keeps a user-supplied value from reshaping the
/// endpoint path (extra segments, `..`, a query string).
fn validate_repo(action_id: &str, repo: &str) -> Result<(), ActionError> {
    let mut parts = repo.split('/');
    let valid = matches!((parts.next(), parts.next(), parts.next()), (Some(owner), Some(name), None)
        if is_repo_segment(owner) && is_repo_segment(name));
    if valid {
        return Ok(());
    }
    Err(ActionError(format!(
        "invalid input for '{action_id}': repo '{repo}' must be 'owner/name'"
    )))
}

fn is_repo_segment(segment: &str) -> bool {
    // Dots are legal inside a repo name, so the charset alone would admit
    // `..` — a segment that walks the endpoint path up instead of naming a
    // repo. Requiring one non-dot character rules out `.` and `..` without
    // rejecting `my.repo`.
    segment.bytes().any(|b| b != b'.')
        && segment
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

// ── github.create_pr ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreatePrInput {
    repo: String,
    title: String,
    #[serde(default)]
    body: String,
    head: String,
    base: String,
}

#[derive(Debug, Deserialize)]
struct CreatedPr {
    html_url: String,
    number: f64,
}

pub struct GithubCreatePrAction {
    base: String,
    client: reqwest::Client,
}

impl GithubCreatePrAction {
    pub fn new() -> Self {
        Self::with_base_url(GITHUB_API.to_string())
    }

    pub fn with_base_url(base: impl Into<String>) -> Self {
        Self {
            base: base.into(),
            client: super::http_client(),
        }
    }
}

impl Default for GithubCreatePrAction {
    fn default() -> Self {
        Self::new()
    }
}

impl Action for GithubCreatePrAction {
    fn manifest(&self) -> ActionManifest {
        ActionManifest {
            id: "github.create_pr",
            title: "GitHub: create pull request",
            group: ActionGroup::Connector,
            auth: ActionAuth::Token,
            credential_label_hint: Some("github"),
            params_schema: json!({
                "type": "object",
                "properties": {
                    "repo": {"type": "string", "minLength": 1},
                    "title": {"type": "string", "minLength": 1},
                    "body": {"type": "string", "default": ""},
                    "head": {"type": "string", "minLength": 1},
                    "base": {"type": "string", "minLength": 1}
                },
                "required": ["repo", "title", "head", "base"],
                "additionalProperties": false
            }),
            fields: vec![
                ActionField::text("repo", "Repository").placeholder("org/repo"),
                ActionField::chip("title", "Title"),
                ActionField::chiparea("body", "Body"),
                ActionField::chip("head", "Branch").placeholder("feature/…"),
                ActionField::text("base", "Base branch").placeholder("main"),
            ],
            has_output_as: false,
            outputs: vec![
                ActionOutput::new("prUrl", ActionOutputType::Text),
                ActionOutput::new("prNumber", ActionOutputType::Number),
            ],
            idempotent: false,
        }
    }

    fn execute<'a>(
        &'a self,
        params: &'a Value,
        ctx: &'a ActionCtx,
    ) -> BoxFuture<'a, Result<ActionOutputs, ActionError>> {
        Box::pin(async move {
            const OP: &str = "GitHub create PR";
            let input: CreatePrInput = parse_input("github.create_pr", params)?;
            validate_repo("github.create_pr", &input.repo)?;

            let mut request = github_headers(
                self.client
                    .post(format!("{}/repos/{}/pulls", self.base, input.repo)),
            )
            .json(&json!({
                "title": input.title,
                "body": input.body,
                "head": input.head,
                "base": input.base,
            }));
            if let Some(creds) = &ctx.creds {
                request = request.bearer_auth(&creds.token);
            }
            let response = request
                .send()
                .await
                .map_err(|err| ActionError(format!("{OP} failed: {err}")))?;
            let status = response.status().as_u16();
            let body = response
                .text()
                .await
                .map_err(|err| ActionError(format!("{OP} failed: {err}")))?;
            if status == 404 && is_app_issued(ctx) {
                return Err(not_installed_error(OP, &input.repo));
            }
            if status >= 400 {
                return Err(http_failure(OP, status, ctx, &body));
            }
            let created: CreatedPr = parse_json(&body, OP)?;

            let mut outputs = ActionOutputs::new();
            outputs.insert("prUrl".to_string(), TokenValue::Text(created.html_url));
            outputs.insert("prNumber".to_string(), TokenValue::Number(created.number));
            Ok(outputs)
        })
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T7.1;
// REST migration off `gh` is the 2026-08-19 provider-connections plan), not a TS port
// confidence: high
// todos: 0
// notes: mirrors ado.rs/notion.rs's shape now (bearer token from ctx.creds,
//        injectable base_url for wiremock tests) instead of shelling out.
