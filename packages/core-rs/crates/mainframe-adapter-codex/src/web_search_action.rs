//! `webSearch` item + its `action` payload. Split out of `thread_item_variants.rs`
//! (todo #356) to keep that file under the 300-line ceiling.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// `results` is deliberately not modeled: its element type is unnamed in codex's
/// own binary and its content is unverified (todo #356 plan, "Established
/// facts") — an unread field is tolerated crate-wide, so it is simply dropped.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchItem {
    pub id: String,
    /// `#[serde(default)]` so an action-only item (e.g. `openPage`) is never
    /// dropped by `deserialize_lenient_items` for lacking a query.
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub action: Option<WebSearchAction>,
}

/// Mirrors codex's `WebSearchAction`. `Other` is both codex's own tag for
/// uncategorized actions and this crate's `#[serde(other)]` fallback for any
/// tag codex adds later, so an unrecognized action degrades to the `search`
/// face instead of dropping the item.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WebSearchAction {
    Search {
        #[serde(default)]
        query: Option<String>,
        #[serde(default)]
        queries: Option<Vec<String>>,
    },
    OpenPage {
        url: String,
    },
    FindInPage {
        url: String,
        pattern: String,
    },
    #[serde(other)]
    Other,
}

impl WebSearchItem {
    /// The tool_use name + input this item resolves to, shared by the live
    /// (`web_search_render.rs`) and reload (`web_search_history.rs`) paths so
    /// an `openPage` item can't render as different verbs on each. `openPage`
    /// wins over a top-level `query` the item may also carry.
    pub(crate) fn tool_use_name_and_input(
        &self,
    ) -> (&'static str, HashMap<String, serde_json::Value>) {
        let mut input = HashMap::new();
        if let Some(WebSearchAction::OpenPage { url }) = &self.action {
            input.insert("url".to_string(), serde_json::json!(url));
            return ("WebFetch", input);
        }
        input.insert("query".to_string(), serde_json::json!(self.query));
        ("WebSearch", input)
    }
}
