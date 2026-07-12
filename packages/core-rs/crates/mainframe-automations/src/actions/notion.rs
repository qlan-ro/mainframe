//! notion.add_row connector (T7.2, Node actions/notion.ts). No schema-lookup
//! endpoint exists yet for per-column Notion property types (contract §9
//! "under-built product surfaces"), so every non-databaseId param is sent as
//! a rich_text property — the params record is already flat key/value
//! ChipText output (dates like ⟨Today⟩ arrive pre-rendered), not a typed
//! Notion schema.

use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::engine::BoxFuture;
use crate::tokens::TokenValue;

use super::manifest::{ActionAuth, ActionGroup, ActionManifest, ActionOutput, ActionOutputType};
use super::{Action, ActionCtx, ActionError, ActionOutputs, http_failure, parse_input};

const NOTION_API: &str = "https://api.notion.com";
const NOTION_VERSION: &str = "2022-06-28";

/// `databaseId` + a flat catchall of string column values (zod
/// `.catchall(z.string())` parity — a non-string extra fails the parse).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddRowInput {
    database_id: String,
    #[serde(flatten)]
    properties: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct CreatedPage {
    url: String,
}

pub struct NotionAddRowAction {
    base: String,
    client: reqwest::Client,
}

impl NotionAddRowAction {
    pub fn new() -> Self {
        Self::with_base_url(NOTION_API.to_string())
    }

    pub fn with_base_url(base: impl Into<String>) -> Self {
        Self {
            base: base.into(),
            client: reqwest::Client::new(),
        }
    }
}

impl Default for NotionAddRowAction {
    fn default() -> Self {
        Self::new()
    }
}

impl Action for NotionAddRowAction {
    fn manifest(&self) -> ActionManifest {
        ActionManifest {
            id: "notion.add_row",
            title: "Notion: add database row",
            group: ActionGroup::Connector,
            auth: ActionAuth::Token,
            credential_label_hint: Some("notion"),
            params_schema: json!({
                "type": "object",
                "properties": {
                    "databaseId": {"type": "string", "minLength": 1}
                },
                "required": ["databaseId"],
                "additionalProperties": {"type": "string"}
            }),
            outputs: vec![ActionOutput::new("pageUrl", ActionOutputType::Text)],
            idempotent: false,
        }
    }

    fn execute<'a>(
        &'a self,
        params: &'a Value,
        ctx: &'a ActionCtx,
    ) -> BoxFuture<'a, Result<ActionOutputs, ActionError>> {
        Box::pin(async move {
            const OP: &str = "Notion add row";
            let input: AddRowInput = parse_input("notion.add_row", params)?;
            let properties: Map<String, Value> = input
                .properties
                .into_iter()
                .map(|(key, value)| (key, json!({"rich_text": [{"text": {"content": value}}]})))
                .collect();

            let mut request = self
                .client
                .post(format!("{}/v1/pages", self.base))
                .header("Notion-Version", NOTION_VERSION)
                .json(&json!({
                    "parent": {"database_id": input.database_id},
                    "properties": properties,
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
            if status >= 400 {
                return Err(http_failure(OP, status, ctx, &body));
            }
            let page: CreatedPage = serde_json::from_str(&body)
                .map_err(|err| ActionError(format!("{OP} failed: unexpected response ({err})")))?;

            let mut outputs = ActionOutputs::new();
            outputs.insert("pageUrl".to_string(), TokenValue::Text(page.url));
            Ok(outputs)
        })
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T7.2), not a TS port
// confidence: high
// todos: 0
// notes: mirrors Node actions/notion.ts (rich_text-only properties until a
//        column-picker/schema endpoint exists — contract §9).
