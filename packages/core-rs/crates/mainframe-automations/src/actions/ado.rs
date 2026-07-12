//! ado.create_item connector (T7.2, Node actions/ado.ts). Azure DevOps
//! auths via PAT basic auth (`:<token>` base64 — reqwest's `basic_auth`
//! with an empty username); the work item type is a URL path segment
//! prefixed with `$`, and the create call is a POST whose body is a
//! JSON-patch document (`application/json-patch+json`) per the ADO REST API
//! — the plan's "ado PATCH" refers to that body format, not the HTTP verb.

use serde::Deserialize;
use serde_json::{Value, json};

use crate::engine::BoxFuture;
use crate::tokens::TokenValue;

use super::manifest::{ActionAuth, ActionGroup, ActionManifest, ActionOutput, ActionOutputType};
use super::{Action, ActionCtx, ActionError, ActionOutputs, http_failure, parse_input};

const ADO_API: &str = "https://dev.azure.com";
const API_VERSION: &str = "7.1";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateItemInput {
    org: String,
    project: String,
    #[serde(rename = "type")]
    item_type: String,
    title: String,
    #[serde(default)]
    description: String,
}

#[derive(Debug, Deserialize)]
struct HtmlLink {
    href: String,
}

#[derive(Debug, Deserialize)]
struct WorkItemLinks {
    html: HtmlLink,
}

#[derive(Debug, Deserialize)]
struct WorkItem {
    id: f64,
    _links: WorkItemLinks,
}

pub struct AdoCreateItemAction {
    base: String,
    client: reqwest::Client,
}

impl AdoCreateItemAction {
    pub fn new() -> Self {
        Self::with_base_url(ADO_API.to_string())
    }

    pub fn with_base_url(base: impl Into<String>) -> Self {
        Self {
            base: base.into(),
            client: reqwest::Client::new(),
        }
    }
}

impl Default for AdoCreateItemAction {
    fn default() -> Self {
        Self::new()
    }
}

impl Action for AdoCreateItemAction {
    fn manifest(&self) -> ActionManifest {
        ActionManifest {
            id: "ado.create_item",
            title: "Azure DevOps: create work item",
            group: ActionGroup::Connector,
            auth: ActionAuth::Token,
            credential_label_hint: Some("ado"),
            params_schema: json!({
                "type": "object",
                "properties": {
                    "org": {"type": "string", "minLength": 1},
                    "project": {"type": "string", "minLength": 1},
                    "type": {"type": "string", "minLength": 1},
                    "title": {"type": "string", "minLength": 1},
                    "description": {"type": "string", "default": ""}
                },
                "required": ["org", "project", "type", "title"],
                "additionalProperties": false
            }),
            outputs: vec![
                ActionOutput::new("workItemId", ActionOutputType::Number),
                ActionOutput::new("url", ActionOutputType::Text),
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
            const OP: &str = "Azure DevOps create item";
            let input: CreateItemInput = parse_input("ado.create_item", params)?;
            let url = format!(
                "{}/{}/{}/_apis/wit/workitems/${}?api-version={API_VERSION}",
                self.base, input.org, input.project, input.item_type
            );

            let mut request = self
                .client
                .post(url)
                .header("Content-Type", "application/json-patch+json")
                .body(
                    json!([
                        {"op": "add", "path": "/fields/System.Title", "value": input.title},
                        {"op": "add", "path": "/fields/System.Description", "value": input.description},
                    ])
                    .to_string(),
                );
            if let Some(creds) = &ctx.creds {
                request = request.basic_auth("", Some(&creds.token));
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
            let item: WorkItem = serde_json::from_str(&body)
                .map_err(|err| ActionError(format!("{OP} failed: unexpected response ({err})")))?;

            let mut outputs = ActionOutputs::new();
            outputs.insert("workItemId".to_string(), TokenValue::Number(item.id));
            outputs.insert("url".to_string(), TokenValue::Text(item._links.html.href));
            Ok(outputs)
        })
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T7.2), not a TS port
// confidence: high
// todos: 0
// notes: mirrors Node actions/ado.ts (System.Title/System.Description
//        json-patch, `_links.html.href` URL, PAT basic auth).
