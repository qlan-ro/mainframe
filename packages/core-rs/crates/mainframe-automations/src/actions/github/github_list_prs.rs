//! `github.list_prs` — split out of `github.rs` to stay under the file line
//! cap. Runs the search API's `/search/issues` endpoint (still the current
//! PR search surface — verified live against api.github.com and GitHub's
//! REST docs on 2026-08-19, no deprecation header on the response); it
//! resolves `author:@me` itself, the same way `gh search prs` used to.

use std::collections::BTreeMap;

use mainframe_github::github_http::{GITHUB_API, github_headers};
use mainframe_types::BoxFuture;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::tokens::TokenValue;

use super::super::http::{client, send_json};
use super::super::manifest::{
    ActionAuth, ActionField, ActionGroup, ActionManifest, ActionMeta, ActionOutput,
    ActionOutputType, ActionParam,
};
use super::super::{Action, ActionCtx, ActionError, ActionOutputs, parse_input};

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
    client: Result<reqwest::Client, reqwest::Error>,
}

impl GithubListPrsAction {
    pub fn new() -> Self {
        Self::with_base_url(GITHUB_API.to_string())
    }

    pub fn with_base_url(base: impl Into<String>) -> Self {
        Self {
            base: base.into(),
            client: client(),
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
        ActionManifest::new(
            ActionMeta {
                id: "github.list_prs",
                title: "GitHub: list my open pull requests",
                group: ActionGroup::Connector,
                auth: ActionAuth::Token,
                credential_label_hint: Some("github"),
                outputs: vec![ActionOutput::new("prs", ActionOutputType::List)],
                idempotent: true,
            },
            vec![ActionParam::field(
                ActionField::text("author", "Author").placeholder("@me"),
                json!({"type": "string", "default": "@me"}),
            )],
            Value::Bool(false),
        )
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

            let mut request = github_headers(
                self.client
                    .as_ref()
                    .map_err(|err| ActionError(format!("{OP} failed: {err}")))?
                    .get(format!("{}/search/issues", self.base)),
            )
            .query(&[("q", query)]);
            if let Some(creds) = &ctx.creds {
                request = request.bearer_auth(&creds.token);
            }
            let found: SearchIssuesResponse = send_json(request, OP, ctx, |_| None).await?;

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
