//! Ask-me form validation (T5.1) — ported from Node ask-me.ts
//! `validateForm` (itself v1 interactions.ts:9, `when` renamed `showWhen`).
//! Error strings cross the wire — keep them byte-identical.

use serde_json::{Map, Value};

use crate::domain::{AutomationFormField, FormFieldType};
use crate::engine::expects::js_string;

/// Ported from Node ask-me.ts `validateForm` (itself v1 interactions.ts:9,
/// `when` renamed `showWhen`). Error strings cross the wire — keep them
/// byte-identical.
pub(crate) fn validate_form(
    fields: &[AutomationFormField],
    payload: &Map<String, Value>,
) -> Vec<String> {
    let mut errors = Vec::new();
    for field in fields {
        if let Some(show_when) = &field.show_when
            && js_string_or_undefined(payload.get(&show_when.key)) != show_when.equals
        {
            continue;
        }

        let value = payload.get(&field.key).filter(|value| !value.is_null());
        let Some(value) = value else {
            // Tri-state on purpose: absent `required` still means required.
            if field.required != Some(false) {
                errors.push(format!("missing required field '{}'", field.key));
            }
            continue;
        };

        if let Some(error) = check_type(field, value) {
            errors.push(error);
        }
    }
    errors
}

fn check_type(field: &AutomationFormField, value: &Value) -> Option<String> {
    match field.field_type {
        FormFieldType::Number if !value.is_number() => {
            Some(format!("'{}' must be a number", field.key))
        }
        FormFieldType::Text | FormFieldType::Textarea if !value.is_string() => {
            Some(format!("'{}' must be a string", field.key))
        }
        FormFieldType::Choice => match &field.options {
            Some(options) if !options.contains(&js_string(value)) => Some(format!(
                "'{}' must be one of {}",
                field.key,
                serde_json::to_string(options).unwrap_or_else(|_| "[]".to_string())
            )),
            _ => None,
        },
        FormFieldType::Multi => match value {
            Value::Array(items) => {
                let options = field.options.as_ref()?;
                let invalid: Vec<&Value> = items
                    .iter()
                    .filter(|item| !options.contains(&js_string(item)))
                    .collect();
                if invalid.is_empty() {
                    return None;
                }
                Some(format!(
                    "'{}' contains invalid values: {}",
                    field.key,
                    serde_json::to_string(&invalid).unwrap_or_else(|_| "[]".to_string())
                ))
            }
            _ => Some(format!("'{}' must be an array", field.key)),
        },
        _ => None,
    }
}

/// JS `String(payload[key])` with the `undefined` spelling for a missing key
/// (Node compares `String(payload[showWhen.key]) !== showWhen.equals`).
fn js_string_or_undefined(value: Option<&Value>) -> String {
    match value {
        None => "undefined".to_string(),
        Some(value) => js_string(value),
    }
}

// PORT STATUS: packages/core/src/automations/verbs/ask-me.ts (validateForm, 139 lines)
// confidence: high
// todos: 0
// notes: tri-state `required` — absent still means required (`!== false`).
