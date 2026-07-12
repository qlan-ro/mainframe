//! `AutomationSummary` — the CRUD-route wire shape (TS `AutomationSummary`,
//! Node rowToSummary): `description` omits when absent, `projectId` is
//! `string | null`.

use serde::Serialize;

use crate::domain::{AutomationDefinition, AutomationScope, ValidationError};
use crate::store::AutomationRecord;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSummary {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub scope: AutomationScope,
    pub project_id: Option<String>,
    pub enabled: bool,
    pub definition: AutomationDefinition,
    pub created_at: i64,
    pub updated_at: i64,
}

pub(super) fn to_summary(record: &AutomationRecord) -> AutomationSummary {
    AutomationSummary {
        id: record.id.clone(),
        name: record.name.clone(),
        description: record.description.clone(),
        scope: record.scope,
        project_id: record.project_id.clone(),
        enabled: record.enabled,
        definition: record.definition.clone(),
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

/// Node AutomationValidationError message: messages joined with `; `, with a
/// fallback when a validator produced no text.
pub(super) fn join_validation(errors: &[ValidationError]) -> String {
    let joined = errors
        .iter()
        .map(|error| error.message.as_str())
        .collect::<Vec<_>>()
        .join("; ");
    if joined.is_empty() {
        "automation definition is invalid".to_string()
    } else {
        joined
    }
}

// PORT STATUS: packages/core/src/automations/service-helpers.ts rowToSummary (12 lines)
// confidence: high
// todos: 0
// notes: —
