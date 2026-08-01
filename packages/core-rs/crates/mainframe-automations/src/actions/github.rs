//! github connector (T7.1), running on the GitHub CLI rather than an HTTP
//! client: `gh` already holds a token in the OS keyring, so these actions
//! need no credential of their own (`auth: none`) and the daemon never
//! stores a GitHub secret. Params arrive pre-rendered plain strings — the
//! run_action executor renders ChipText before invoking any action other
//! than run_command. `github.list_prs` has no `repo` param: `gh search prs`
//! spans every repo the user can see and resolves `@me` itself, which the
//! REST search endpoint the old client called never did. The CLI handle is
//! injectable so tests drive a stub binary.

use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::{Value, json};

use crate::engine::BoxFuture;
use crate::tokens::TokenValue;

use super::gh::{GhCli, validate_repo};
use super::manifest::{ActionAuth, ActionGroup, ActionManifest, ActionOutput, ActionOutputType};
use super::{Action, ActionAvailability, ActionCtx, ActionError, ActionOutputs, parse_input};

async fn availability(gh: &GhCli) -> ActionAvailability {
    match gh.status().await.unavailable_reason() {
        Some(reason) => ActionAvailability::Unavailable(reason),
        None => ActionAvailability::Available,
    }
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
    gh: GhCli,
}

impl GithubCreatePrAction {
    pub(crate) fn new(gh: GhCli) -> Self {
        Self { gh }
    }
}

impl Action for GithubCreatePrAction {
    fn manifest(&self) -> ActionManifest {
        ActionManifest {
            id: "github.create_pr",
            title: "GitHub: create pull request",
            group: ActionGroup::Connector,
            auth: ActionAuth::None,
            credential_label_hint: None,
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

    fn availability<'a>(&'a self) -> BoxFuture<'a, ActionAvailability> {
        Box::pin(availability(&self.gh))
    }

    fn execute<'a>(
        &'a self,
        params: &'a Value,
        _ctx: &'a ActionCtx,
    ) -> BoxFuture<'a, Result<ActionOutputs, ActionError>> {
        Box::pin(async move {
            const OP: &str = "GitHub create PR";
            let input: CreatePrInput = parse_input("github.create_pr", params)?;
            validate_repo("github.create_pr", &input.repo)?;

            let payload = json!({
                "title": input.title,
                "body": input.body,
                "head": input.head,
                "base": input.base,
            })
            .to_string();
            let endpoint = format!("repos/{}/pulls", input.repo);
            let stdout = self
                .gh
                .output(
                    OP,
                    &["api", &endpoint, "--method", "POST", "--input", "-"],
                    Some(&payload),
                )
                .await?;
            let created: CreatedPr = parse_json(&stdout, OP)?;

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
struct PrAuthor {
    login: String,
}

#[derive(Debug, Deserialize)]
struct FoundPr {
    url: String,
    title: String,
    number: f64,
    author: PrAuthor,
}

pub struct GithubListPrsAction {
    gh: GhCli,
}

impl GithubListPrsAction {
    pub(crate) fn new(gh: GhCli) -> Self {
        Self { gh }
    }
}

impl Action for GithubListPrsAction {
    fn manifest(&self) -> ActionManifest {
        ActionManifest {
            id: "github.list_prs",
            title: "GitHub: list my open pull requests",
            group: ActionGroup::Connector,
            auth: ActionAuth::None,
            credential_label_hint: None,
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

    fn availability<'a>(&'a self) -> BoxFuture<'a, ActionAvailability> {
        Box::pin(availability(&self.gh))
    }

    fn execute<'a>(
        &'a self,
        params: &'a Value,
        _ctx: &'a ActionCtx,
    ) -> BoxFuture<'a, Result<ActionOutputs, ActionError>> {
        Box::pin(async move {
            const OP: &str = "GitHub list PRs";
            let input: ListPrsInput = parse_input("github.list_prs", params)?;
            let stdout = self
                .gh
                .output(
                    OP,
                    &[
                        "search",
                        "prs",
                        "--state",
                        "open",
                        "--author",
                        &input.author,
                        "--json",
                        "url,title,number,author",
                    ],
                    None,
                )
                .await?;
            let found: Vec<FoundPr> = parse_json(&stdout, OP)?;

            let prs = found
                .into_iter()
                .map(|pr| {
                    TokenValue::Record(BTreeMap::from([
                        ("url".to_string(), TokenValue::Text(pr.url)),
                        ("title".to_string(), TokenValue::Text(pr.title)),
                        ("number".to_string(), TokenValue::Number(pr.number)),
                        ("author".to_string(), TokenValue::Text(pr.author.login)),
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
// notes: diverges from Node actions/github.ts on purpose — auth and transport
//        both moved to the GitHub CLI, so no token is stored or sent by us.
