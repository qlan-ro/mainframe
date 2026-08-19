//! `github.list_prs` — split out of `github.rs` to stay under the file line
//! cap. Runs the search API's `/search/issues` endpoint (still the current
//! PR search surface — verified live against api.github.com and GitHub's
//! REST docs on 2026-08-19, no deprecation header on the response); it
//! resolves `author:@me` itself, the same way `gh search prs` used to.

use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::{Value, json};

use crate::engine::BoxFuture;
use crate::github_http::{GITHUB_API, github_headers};
use crate::tokens::TokenValue;

use super::super::manifest::{
    ActionAuth, ActionField, ActionGroup, ActionManifest, ActionOutput, ActionOutputType,
};
use super::super::{Action, ActionCtx, ActionError, ActionOutputs, http_failure, parse_input};
use super::parse_json;

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
struct SearchIssuesResponse {
    items: Vec<FoundPr>,
}

#[derive(Debug, Deserialize)]
struct PrAuthor {
    login: String,
}

#[derive(Debug, Deserialize)]
struct FoundPr {
    html_url: String,
    title: String,
    number: f64,
    user: PrAuthor,
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
            client: super::super::http_client(),
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
            fields: vec![ActionField::text("author", "Author").placeholder("@me")],
            has_output_as: false,
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

            let mut request =
                github_headers(self.client.get(format!("{}/search/issues", self.base)))
                    .query(&[("q", query)]);
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
            if status >= 400 {
                return Err(http_failure(OP, status, ctx, &body));
            }
            let found: SearchIssuesResponse = parse_json(&body, OP)?;

            let prs = found
                .items
                .into_iter()
                .map(|pr| {
                    TokenValue::Record(BTreeMap::from([
                        ("url".to_string(), TokenValue::Text(pr.html_url)),
                        ("title".to_string(), TokenValue::Text(pr.title)),
                        ("number".to_string(), TokenValue::Number(pr.number)),
                        ("author".to_string(), TokenValue::Text(pr.user.login)),
                    ]))
                })
                .collect();

            let mut outputs = ActionOutputs::new();
            outputs.insert("prs".to_string(), TokenValue::List(prs));
            Ok(outputs)
        })
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T7.1;
// REST migration off `gh` is the 2026-08-19 provider-connections plan), not a TS port
// confidence: high
// todos: 0
// notes: split out of github.rs to stay under the 300-line file cap.
