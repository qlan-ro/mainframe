//! Flat-id action registry (T6.2, Node actions/registry.ts). The wire
//! `ActionCatalogEntry.id` doubles as the registry key — v2 actions are
//! flat ids (`run_command`, `github.create_pr`, `mcp:<server>:<tool>`), not
//! v1's two-level connector.action namespace. Registration order is catalog
//! order.

use super::manifest::ActionManifest;
use super::{Action, ActionError};

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
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T6.2), not a TS port
// confidence: high
// todos: 0
// notes: Vec keeps Node's Map-insertion catalog order; linear lookup is fine
//        for the ≤10-action catalog.
