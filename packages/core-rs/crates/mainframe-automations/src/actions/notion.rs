//! notion.add_row connector. No schema-lookup endpoint exists yet for
//! per-column Notion property types (contract §9 "under-built product
//! surfaces"), so every non-databaseId param is sent as a rich_text property —
//! the params record is already flat key/value ChipText output (dates like
//! ⟨Today⟩ arrive pre-rendered), not a typed Notion schema.

use std::collections::BTreeMap;

use mainframe_types::BoxFuture;
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::tokens::TokenValue;

use super::http::{client, send_json};
use super::manifest::{
    ActionAuth, ActionField, ActionGroup, ActionManifest, ActionMeta, ActionOutput,
    ActionOutputType, ActionParam,
};
use super::{Action, ActionCtx, ActionError, ActionOutputs, parse_input};

const NOTION_API: &str = "https://api.notion.com";
const NOTION_VERSION: &str = "2022-06-28";

/// `databaseId` + a flat catchall of string column values (a non-string
/// extra fails the parse).
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
    client: Result<reqwest::Client, reqwest::Error>,
}

impl NotionAddRowAction {
    pub fn new() -> Self {
        Self::with_base_url(NOTION_API.to_string())
    }

    pub fn with_base_url(base: impl Into<String>) -> Self {
        Self {
            base: base.into(),
            client: client(),
        }
    }
}

impl Default for NotionAddRowAction {
    fn default() -> Self {
        Self::new()
    }
}

/// The manifest, readable without building the action (see
/// `actions::known_manifest`).
pub(crate) fn add_row_manifest() -> ActionManifest {
    ActionManifest::new(
        ActionMeta {
            id: "notion.add_row",
            title: "Notion: add database row",
            group: ActionGroup::Connector,
            auth: ActionAuth::Token,
            credential_label_hint: Some("notion"),
            outputs: vec![ActionOutput::new("pageUrl", ActionOutputType::Text)],
            idempotent: false,
        },
        vec![
            ActionParam::field(
                ActionField::chip("databaseId", "Database"),
                json!({"type": "string", "minLength": 1}),
            )
            .required(),
        ],
        json!({"type": "string"}),
    )
}

impl Action for NotionAddRowAction {
    fn manifest(&self) -> ActionManifest {
        add_row_manifest()
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
                .as_ref()
                .map_err(|err| ActionError(format!("HTTP client initialization failed: {err}")))?
                .post(format!("{}/v1/pages", self.base))
                .header("Notion-Version", NOTION_VERSION)
                .json(&json!({
                    "parent": {"database_id": input.database_id},
                    "properties": properties,
                }));
            if let Some(creds) = &ctx.creds {
                request = request.bearer_auth(&creds.token);
            }
            let page: CreatedPage = send_json(request, OP, ctx, |_| None).await?;

            let mut outputs = ActionOutputs::new();
            outputs.insert("pageUrl".to_string(), TokenValue::Text(page.url));
            Ok(outputs)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn initialization_failure_is_an_action_error_without_a_fallback_request() {
        let action = NotionAddRowAction {
            base: "http://127.0.0.1:1".to_string(),
            client: mainframe_runtime::http::builder()
                .user_agent("invalid\nagent")
                .build(),
        };
        assert!(action.client.is_err());
        let ctx = ActionCtx {
            creds: None,
            credential_label: None,
            idempotency_key: "run:step".to_string(),
            project_root: "/project".to_string(),
            worktree_path: None,
        };
        let error = action
            .execute(&json!({"databaseId": "db-1", "Name": "row"}), &ctx)
            .await
            .unwrap_err();
        assert_eq!(error.0, "HTTP client initialization failed: builder error");
    }
}
