//! Per-action manifest: id, catalog metadata, named outputs typed by the exact
//! contract §5 enum `text|number|list|record` (no `none` — a no-output action
//! carries an empty outputs list), the `idempotent` flag feeding the
//! restart-mid-action policy, and the editor's field schema
//! (`fields`/`has_output_as`). The manifest is the single source for an
//! action: the validator's output table, the `outputAs` lookup and the wire
//! `ActionCatalogEntry` all read it. Each `ActionParam` supplies a JSON
//! property and optionally an editor control, so the params schema, the field
//! list and `has_output_as` are generated together and cannot drift.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

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

/// Wire contract: the UI matches these values in `ActionFieldControl`
/// (`packages/ui/src/features/automations/steps/action-fields.ts`), so any
/// new control value needs a matching case added there before it means
/// anything.
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
/// match the keys the action's own `parse_input` deserializes;
/// `ActionManifest::new` builds the field list and `params_schema` from the
/// same params, so every field key is a schema property.
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

    pub(crate) fn chiparea(key: &str, label: &str) -> Self {
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
    /// JSON Schema for the action's params form, derived from `ActionParam`s.
    pub params_schema: Value,
    /// The editor's auto-form field list, derived from the same `ActionParam`s.
    pub fields: Vec<ActionField>,
    /// Whether the step-level `outputAs` (text/lines) applies to this action:
    /// true when its params declare `outputAs`.
    pub has_output_as: bool,
    pub outputs: Vec<ActionOutput>,
    /// Non-idempotent actions get a persisted `running` marker before executing
    /// and are never silently re-run on restart.
    pub idempotent: bool,
}

/// The authored half of a manifest; `ActionManifest::new` derives the rest
/// (`params_schema`, `fields`, `has_output_as`) from the action's params.
pub(crate) struct ActionMeta {
    pub id: &'static str,
    pub title: &'static str,
    pub group: ActionGroup,
    pub auth: ActionAuth,
    pub credential_label_hint: Option<&'static str>,
    pub outputs: Vec<ActionOutput>,
    pub idempotent: bool,
}

/// One input property: its JSON Schema and, unless the input is hidden from
/// the editor's auto-form (`outputAs`, `headers`, …), the control that edits
/// it.
pub(crate) struct ActionParam {
    key: String,
    schema: Value,
    field: Option<ActionField>,
    required: bool,
}

impl ActionParam {
    pub(crate) fn field(field: ActionField, schema: Value) -> Self {
        Self {
            key: field.key.clone(),
            schema,
            field: Some(field),
            required: false,
        }
    }

    pub(crate) fn hidden(key: &str, schema: Value) -> Self {
        Self {
            key: key.to_string(),
            schema,
            field: None,
            required: false,
        }
    }

    #[must_use]
    pub(crate) fn required(mut self) -> Self {
        self.required = true;
        self
    }
}

/// The step-level text/lines switch; an action takes it by declaring a param
/// with this key.
const OUTPUT_AS_KEY: &str = "outputAs";

impl ActionManifest {
    /// Builds the manifest, generating the params JSON Schema (properties in
    /// param order, `required` when any param is, `additionalProperties` as
    /// given) and the editor field list from the same `params`.
    pub(crate) fn new(
        meta: ActionMeta,
        params: Vec<ActionParam>,
        additional_properties: Value,
    ) -> Self {
        let has_output_as = params.iter().any(|param| param.key == OUTPUT_AS_KEY);
        let mut properties = Map::new();
        let mut required = Vec::new();
        let mut fields = Vec::new();
        for param in params {
            if param.required {
                required.push(Value::String(param.key.clone()));
            }
            fields.extend(param.field);
            properties.insert(param.key, param.schema);
        }
        let mut schema = Map::new();
        schema.insert("type".into(), Value::String("object".into()));
        schema.insert("properties".into(), Value::Object(properties));
        if !required.is_empty() {
            schema.insert("required".into(), Value::Array(required));
        }
        schema.insert("additionalProperties".into(), additional_properties);
        Self {
            id: meta.id,
            title: meta.title,
            group: meta.group,
            auth: meta.auth,
            credential_label_hint: meta.credential_label_hint,
            params_schema: Value::Object(schema),
            fields,
            has_output_as,
            outputs: meta.outputs,
            idempotent: meta.idempotent,
        }
    }
}
