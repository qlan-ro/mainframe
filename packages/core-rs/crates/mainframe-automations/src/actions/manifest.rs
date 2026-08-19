//! Per-action manifest (T6.2): id, catalog metadata, named outputs typed by
//! the exact contract §5 enum `text|number|list|record` (no `none` — a
//! no-output action carries an empty outputs list), the engine-internal
//! `idempotent` flag feeding the Decision-12 restart policy, and the editor's
//! field schema (`fields`/`has_output_as` — Part 0 of the 2026-08-18
//! automations-provider-connections plan). `fields` is a sibling to
//! `params_schema`, not a translation of it: JSON Schema can't express "this
//! is a code editor" or "this is a token-accepting chip field", so the
//! daemon authors the control types by hand, same as `params_schema` itself.
//! Both `idempotent` and `fields`/`has_output_as` now cross the wire in the
//! `ActionCatalogEntry` projection (T7.3/T9.3).

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

/// Mirrors the UI's `ActionFieldControl` (`steps/action-fields.ts`) exactly —
/// that file is the consumer, so any new control value needs a matching case
/// added there before it means anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActionFieldControl {
    Text,
    Select,
    Chip,
    Chiparea,
    Code,
    Columns,
}

/// A field only renders when a sibling field's committed value equals this.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionFieldShowWhen {
    pub key: String,
    pub equals: String,
}

/// One control in the editor's auto-generated params form. Field `key`s must
/// match the keys the action's own `parse_input` deserializes — the drift
/// guard in `registry_tests.rs` asserts every field key is a property of
/// `params_schema`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionField {
    pub key: String,
    pub label: String,
    pub control: ActionFieldControl,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_when: Option<ActionFieldShowWhen>,
}

impl ActionField {
    fn new(key: &str, label: &str, control: ActionFieldControl) -> Self {
        Self {
            key: key.to_string(),
            label: label.to_string(),
            control,
            options: Vec::new(),
            placeholder: None,
            show_when: None,
        }
    }

    pub fn text(key: &str, label: &str) -> Self {
        Self::new(key, label, ActionFieldControl::Text)
    }

    pub fn select(key: &str, label: &str, options: &[&str]) -> Self {
        let mut field = Self::new(key, label, ActionFieldControl::Select);
        field.options = options.iter().map(|o| o.to_string()).collect();
        field
    }

    pub fn chip(key: &str, label: &str) -> Self {
        Self::new(key, label, ActionFieldControl::Chip)
    }

    pub fn chiparea(key: &str, label: &str) -> Self {
        Self::new(key, label, ActionFieldControl::Chiparea)
    }

    pub fn code(key: &str, label: &str) -> Self {
        Self::new(key, label, ActionFieldControl::Code)
    }

    #[must_use]
    pub fn placeholder(mut self, placeholder: &str) -> Self {
        self.placeholder = Some(placeholder.to_string());
        self
    }

    #[must_use]
    pub fn show_when(mut self, key: &str, equals: &str) -> Self {
        self.show_when = Some(ActionFieldShowWhen {
            key: key.to_string(),
            equals: equals.to_string(),
        });
        self
    }
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
    /// `toJSONSchema`; Rust authors the equivalent schema by hand). Validated
    /// server-side by each action's `parse_input`.
    pub params_schema: Value,
    /// The editor's auto-form field list — a sibling of `params_schema`, not
    /// derived from it (see module doc).
    pub fields: Vec<ActionField>,
    /// Whether the step-level `outputAs` (text/lines) applies to this action.
    /// True for exactly `run_command` and `files.read` — the two whose
    /// `parse_input` accepts an `outputAs` param
    /// (`engine/run_action_verb.rs`'s `ACTIONS_WITH_OUTPUT_AS`).
    pub has_output_as: bool,
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
