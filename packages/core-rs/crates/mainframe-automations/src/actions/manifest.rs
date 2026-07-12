//! Per-action manifest (T6.2): id, catalog metadata, named outputs typed by
//! the exact contract §5 enum `text|number|list|record` (no `none` — a
//! no-output action carries an empty outputs list), and the engine-internal
//! `idempotent` flag feeding the Decision-12 restart policy. The wire
//! `ActionCatalogEntry` projection (which drops `idempotent`) lands with the
//! catalog route (T7.3/T9.3).

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActionOutputType {
    Text,
    Number,
    List,
    Record,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActionOutput {
    pub name: String,
    #[serde(rename = "type")]
    pub output_type: ActionOutputType,
}

impl ActionOutput {
    pub fn new(name: impl Into<String>, output_type: ActionOutputType) -> Self {
        Self {
            name: name.into(),
            output_type,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActionGroup {
    Builtin,
    Connector,
    Mcp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActionAuth {
    None,
    Token,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ActionManifest {
    pub id: &'static str,
    pub title: &'static str,
    pub group: ActionGroup,
    pub auth: ActionAuth,
    /// Suggested credential label shown by the editor (e.g. `github`).
    pub credential_label_hint: Option<&'static str>,
    /// JSON Schema for the action's params form (Node emits zod's
    /// `toJSONSchema`; Rust authors the equivalent schema by hand).
    pub params_schema: Value,
    pub outputs: Vec<ActionOutput>,
    /// Decision 12: non-idempotent actions get a persisted `running` marker
    /// before executing and are never silently re-run on restart.
    pub idempotent: bool,
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T6.2), not a TS port
// confidence: high
// todos: 0
// notes: mirrors Node actions/types.ts ActionDef metadata; params_schema
//        byte-parity with zod's toJSONSchema is a route-diff concern (T9.3),
//        not asserted here.
