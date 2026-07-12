//! The automation definition (contract §1) and the create-input shape the
//! fixtures under `packages/types/fixtures/automations/` use (contract §8).
//! Name/description/scope/projectId/enabled are DB columns, not part of the
//! definition itself.

use serde::{Deserialize, Serialize};

use super::step::Step;
use super::trigger::Trigger;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutomationDefinition {
    pub triggers: Vec<Trigger>,
    pub steps: Vec<Step>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationScope {
    Global,
    Project,
}

/// `POST /api/automations` body and the canonical fixture-file shape.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutomationCreateInput {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub scope: AutomationScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub definition: AutomationDefinition,
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T1.1), not a TS port
// confidence: high
// todos: 0
// notes: run/interaction/timeline summaries land with the store phase (T2.x).
