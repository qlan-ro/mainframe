//! Flat-id action registry (T6.2, Node actions/registry.ts). The wire
//! `ActionCatalogEntry.id` doubles as the registry key — v2 actions are
//! flat ids (`run_command`, `github.create_pr`, `mcp:<server>:<tool>`), not
//! v1's two-level connector.action namespace. Registration order is catalog
//! order.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::manifest::{ActionAuth, ActionGroup, ActionManifest, ActionOutput, ActionOutputType};
use super::{Action, ActionError};

/// Wire projection of a manifest (types `ActionCatalogEntry`, the
/// `GET /api/automation-actions` body). Drops the engine-internal
/// `idempotent` flag; owns dynamic `mcp:<server>:<tool>` ids the static
/// manifest's `&'static str` cannot carry — that is the whole MCP seam at
/// launch (contract §9: no client, no discovery, no `actions/mcp.rs`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionCatalogEntry {
    pub id: String,
    pub title: String,
    pub group: ActionGroup,
    pub auth: ActionAuth,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential_label_hint: Option<String>,
    pub params_schema: Value,
    pub outputs: Vec<ActionOutput>,
}

impl ActionCatalogEntry {
    fn from_manifest(manifest: &ActionManifest) -> Self {
        Self {
            id: manifest.id.to_string(),
            title: manifest.title.to_string(),
            group: manifest.group,
            auth: manifest.auth,
            credential_label_hint: manifest.credential_label_hint.map(str::to_string),
            params_schema: manifest.params_schema.clone(),
            outputs: manifest.outputs.clone(),
        }
    }

    /// The reserved shape a live MCP tool would occupy post-launch (R5):
    /// `mcp:<server>:<tool>`, output `{result: text}` (contract §5).
    pub fn mcp_seam(server: &str, tool: &str) -> Self {
        Self {
            id: format!("mcp:{server}:{tool}"),
            title: format!("{server}: {tool}"),
            group: ActionGroup::Mcp,
            auth: ActionAuth::None,
            credential_label_hint: None,
            params_schema: json!({"type": "object", "additionalProperties": true}),
            outputs: vec![ActionOutput::new("result", ActionOutputType::Text)],
        }
    }
}

#[derive(Default)]
pub struct ActionRegistry {
    actions: Vec<Box<dyn Action>>,
}

impl ActionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Unlike Node's silent `Map.set` overwrite, a duplicate id is an error
    /// (plan T6.2) — a collision means two actions fight over one catalog id.
    pub fn register(&mut self, action: Box<dyn Action>) -> Result<(), ActionError> {
        let id = action.manifest().id;
        if self.actions.iter().any(|a| a.manifest().id == id) {
            return Err(ActionError(format!("duplicate action id '{id}'")));
        }
        self.actions.push(action);
        Ok(())
    }

    pub fn resolve(&self, action_id: &str) -> Result<&dyn Action, ActionError> {
        self.actions
            .iter()
            .map(Box::as_ref)
            .find(|a| a.manifest().id == action_id)
            .ok_or_else(|| ActionError(format!("unknown action '{action_id}'")))
    }

    /// Feeds the interpreter's restart-mid-action policy (Decision 12):
    /// unregistered ids are treated as non-idempotent.
    pub fn is_idempotent(&self, action_id: &str) -> bool {
        self.resolve(action_id)
            .map(|a| a.manifest().idempotent)
            .unwrap_or(false)
    }

    pub fn catalog(&self) -> Vec<ActionManifest> {
        self.actions.iter().map(|a| a.manifest()).collect()
    }

    /// `GET /api/automation-actions` body (T7.3/T9.3).
    pub fn wire_catalog(&self) -> Vec<ActionCatalogEntry> {
        self.actions
            .iter()
            .map(|a| ActionCatalogEntry::from_manifest(&a.manifest()))
            .collect()
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T6.2), not a TS port
// confidence: high
// todos: 0
// notes: Vec keeps Node's Map-insertion catalog order; linear lookup is fine
//        for the ≤10-action catalog.
