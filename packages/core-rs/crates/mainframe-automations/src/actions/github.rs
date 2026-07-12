//! github connector (T7.1, Node actions/github.ts). Params arrive
//! pre-rendered plain strings — the run_action executor renders ChipText
//! before invoking any action other than run_command. `github.list_prs` has
//! no `repo` param: it uses the search API's `author:@me` qualifier across
//! all repos. Base URL injectable for wiremock tests.

use std::collections::BTreeMap;

use reqwest::RequestBuilder;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::engine::BoxFuture;
use crate::tokens::TokenValue;

use super::manifest::{ActionAuth, ActionGroup, ActionManifest, ActionOutput, ActionOutputType};
use super::{Action, ActionCtx, ActionError, ActionOutputs, http_failure, parse_input};

const GITHUB_API: &str = "https://api.github.com";
const API_VERSION: &str = "2022-11-28";

fn with_auth(request: RequestBuilder, ctx: &ActionCtx) -> RequestBuilder {
    let request = request
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", API_VERSION);
    match &ctx.creds {
        Some(creds) => request.bearer_auth(&creds.token),
        None => request,
    }
}

async fn read_response(
    response: reqwest::Response,
    op: &str,
    ctx: &ActionCtx,
) -> Result<String, ActionError> {
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|err| ActionError(format!("{op} failed: {err}")))?;
    if status >= 400 {
        return Err(http_failure(op, status, ctx, &body));
    }
    Ok(body)
}

fn parse_json<T: serde::de::DeserializeOwned>(body: &str, op: &str) -> Result<T, ActionError> {
    serde_json::from_str(body)
        .map_err(|err| ActionError(format!("{op} failed: unexpected response ({err})")))
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
            client: reqwest::Client::new(),
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
            let url = format!("{}/repos/{}/pulls", self.base, input.repo);
            let response = with_auth(self.client.post(&url), ctx)
                .json(&json!({
                    "title": input.title,
                    "body": input.body,
                    "head": input.head,
                    "base": input.base,
                }))
                .send()
                .await
                .map_err(|err| ActionError(format!("{OP} failed: {err}")))?;
            let body = read_response(response, OP, ctx).await?;
            let created: CreatedPr = parse_json(&body, OP)?;

            let mut outputs = ActionOutputs::new();
            outputs.insert("prUrl".to_string(), TokenValue::Text(created.html_url));
            outputs.insert("prNumber".to_string(), TokenValue::Number(created.number));
            Ok(outputs)
        })
    }
}

// ── github.list_prs ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ListPrsInput {
    #[serde(default = "default_author")]
    author: String,
}

fn default_author() -> String {
    "@me".to_string()
}

#[derive(Debug, Deserialize)]
struct SearchUser {
    login: String,
}

#[derive(Debug, Deserialize)]
struct SearchItem {
    html_url: String,
    title: String,
    number: f64,
    user: SearchUser,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    items: Vec<SearchItem>,
}

pub struct GithubListPrsAction {
    base: String,
    client: reqwest::Client,
}

impl GithubListPrsAction {
    pub fn new() -> Self {
        Self::with_base_url(GITHUB_API.to_string())
    }

    pub fn with_base_url(base: impl Into<String>) -> Self {
        Self {
            base: base.into(),
            client: reqwest::Client::new(),
        }
    }
}

impl Default for GithubListPrsAction {
    fn default() -> Self {
        Self::new()
    }
}

impl Action for GithubListPrsAction {
    fn manifest(&self) -> ActionManifest {
        ActionManifest {
            id: "github.list_prs",
            title: "GitHub: list my open pull requests",
            group: ActionGroup::Connector,
            auth: ActionAuth::Token,
            credential_label_hint: Some("github"),
            params_schema: json!({
                "type": "object",
                "properties": {
                    "author": {"type": "string", "default": "@me"}
                },
                "additionalProperties": false
            }),
            outputs: vec![ActionOutput::new("prs", ActionOutputType::List)],
            idempotent: true,
        }
    }

    fn execute<'a>(
        &'a self,
        params: &'a Value,
        ctx: &'a ActionCtx,
    ) -> BoxFuture<'a, Result<ActionOutputs, ActionError>> {
        Box::pin(async move {
            const OP: &str = "GitHub list PRs";
            let input: ListPrsInput = parse_input("github.list_prs", params)?;
            let query = format!("is:pr state:open author:{}", input.author);
            let url = format!("{}/search/issues", self.base);
            let response = with_auth(self.client.get(&url).query(&[("q", query)]), ctx)
                .send()
                .await
                .map_err(|err| ActionError(format!("{OP} failed: {err}")))?;
            let body = read_response(response, OP, ctx).await?;
            let search: SearchResponse = parse_json(&body, OP)?;

            let prs = search
                .items
                .into_iter()
                .map(|item| {
                    TokenValue::Record(BTreeMap::from([
                        ("url".to_string(), TokenValue::Text(item.html_url)),
                        ("title".to_string(), TokenValue::Text(item.title)),
                        ("number".to_string(), TokenValue::Number(item.number)),
                        ("author".to_string(), TokenValue::Text(item.user.login)),
                    ]))
                })
                .collect();

            let mut outputs = ActionOutputs::new();
            outputs.insert("prs".to_string(), TokenValue::List(prs));
            Ok(outputs)
        })
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T7.1), not a TS port
// confidence: high
// todos: 0
// notes: mirrors Node actions/github.ts (search author:@me, vnd.github+json,
//        500-char body snippet); Rust adds the credential-label-naming 401
//        form (plan T7.1) via actions::http_failure.
