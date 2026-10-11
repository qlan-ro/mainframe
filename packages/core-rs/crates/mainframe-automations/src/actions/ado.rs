//! ado.create_item connector. Azure DevOps auths via PAT basic auth (`:<token>`
//! base64 — reqwest's `basic_auth` with an empty username); the work item type
//! is a URL path segment prefixed with `$`, and the create call is a POST whose
//! body is a JSON-patch document (`application/json-patch+json`) per the ADO
//! REST API — "patch" here is the body format, not the HTTP verb.

use mainframe_types::BoxFuture;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::tokens::TokenValue;

use super::http::{client, send_json};
use super::manifest::{
    ActionAuth, ActionField, ActionGroup, ActionManifest, ActionMeta, ActionOutput,
    ActionOutputType, ActionParam,
};
use super::{Action, ActionCtx, ActionError, ActionOutputs, parse_input};

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
    client: Result<reqwest::Client, reqwest::Error>,
}

impl AdoCreateItemAction {
    pub fn new() -> Self {
        Self::with_base_url(ADO_API.to_string())
    }

    pub fn with_base_url(base: impl Into<String>) -> Self {
        Self {
            base: base.into(),
            client: client(),
        }
    }
}

impl Default for AdoCreateItemAction {
    fn default() -> Self {
        Self::new()
    }
}

/// The manifest, readable without building the action (see
/// `actions::known_manifest`).
pub(crate) fn create_item_manifest() -> ActionManifest {
    ActionManifest::new(
        ActionMeta {
            id: "ado.create_item",
            title: "Azure DevOps: create work item",
            group: ActionGroup::Connector,
            auth: ActionAuth::Token,
            credential_label_hint: Some("ado"),
            outputs: vec![
                ActionOutput::new("workItemId", ActionOutputType::Number),
                ActionOutput::new("url", ActionOutputType::Text),
            ],
            idempotent: false,
        },
        vec![
            ActionParam::field(
                ActionField::text("org", "Organization").placeholder("my-org"),
                json!({"type": "string", "minLength": 1}),
            )
            .required(),
            ActionParam::field(
                ActionField::text("project", "Project").placeholder("my-project"),
                json!({"type": "string", "minLength": 1}),
            )
            .required(),
            ActionParam::field(
                ActionField::select("type", "Type", &["Task", "Bug", "User Story"]),
                json!({"type": "string", "minLength": 1}),
            )
            .required(),
            ActionParam::field(
                ActionField::chip("title", "Title"),
                json!({"type": "string", "minLength": 1}),
            )
            .required(),
            ActionParam::field(
                ActionField::chiparea("description", "Description"),
                json!({"type": "string", "default": ""}),
            ),
        ],
        Value::Bool(false),
    )
}

impl Action for AdoCreateItemAction {
    fn manifest(&self) -> ActionManifest {
        create_item_manifest()
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
                .as_ref()
                .map_err(|err| ActionError(format!("HTTP client initialization failed: {err}")))?
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
            let item: WorkItem = send_json(request, OP, ctx, |_| None).await?;

            let mut outputs = ActionOutputs::new();
            outputs.insert("workItemId".to_string(), TokenValue::Number(item.id));
            outputs.insert("url".to_string(), TokenValue::Text(item._links.html.href));
            Ok(outputs)
        })
    }
}
