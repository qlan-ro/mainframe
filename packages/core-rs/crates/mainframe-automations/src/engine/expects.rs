//! A2 structured agent outputs (T4.4, Node verbs/expects.ts): the output
//! contract appended to the prompt, the corrective-retry message, and the
//! parse/validate/coerce pass over the agent's final message. Every string
//! here crosses the wire (prompts, retry messages, step errors) — keep them
//! byte-identical to Node.

use serde_json::{Map, Value};

use crate::domain::{ExpectedOutput, ExpectedOutputType};

pub(crate) fn build_output_contract(expects: &[ExpectedOutput]) -> String {
    format!(
        "\n\nEnd your final message with a JSON object matching this shape (and nothing after it): {}",
        describe_shape(expects)
    )
}

pub(crate) fn build_correction_message(reason: &str, expects: &[ExpectedOutput]) -> String {
    format!(
        "That response didn't include the expected JSON ({reason}).{}",
        build_output_contract(expects)
    )
}

fn describe_shape(expects: &[ExpectedOutput]) -> String {
    let fields = expects
        .iter()
        .map(|field| format!("\"{}\": {}", field.key, describe_type(field)))
        .collect::<Vec<_>>()
        .join(", ");
    format!("{{{fields}}}")
}

fn describe_type(field: &ExpectedOutput) -> String {
    match field.output_type {
        ExpectedOutputType::Choice => format!(
            "one of {}",
            serde_json::to_string(field.options.as_deref().unwrap_or_default())
                .unwrap_or_else(|_| "[]".to_string())
        ),
        ExpectedOutputType::Text => "<text>".to_string(),
        ExpectedOutputType::Number => "<number>".to_string(),
        ExpectedOutputType::List => "<list>".to_string(),
    }
}

/// Extracts the LAST top-level JSON object from `text` and validates every
/// declared key, coercing per type. `Err` carries the plain-language reason
/// used in the correction message / step error.
pub(crate) fn parse_expected(
    text: &str,
    expects: &[ExpectedOutput],
) -> Result<Map<String, Value>, String> {
    let json = extract_last_json_object(text)
        .ok_or_else(|| "no JSON object found in the response".to_string())?;

    let mut outputs = Map::new();
    for field in expects {
        let raw = json
            .get(&field.key)
            .ok_or_else(|| format!("missing key '{}'", field.key))?;
        outputs.insert(field.key.clone(), coerce_field(raw, field)?);
    }
    Ok(outputs)
}

fn coerce_field(raw: &Value, field: &ExpectedOutput) -> Result<Value, String> {
    match field.output_type {
        ExpectedOutputType::Text => match raw {
            Value::String(_) => Ok(raw.clone()),
            _ => Err(format!("'{}' must be a string", field.key)),
        },
        ExpectedOutputType::Number => {
            let number = match raw {
                Value::Number(n) => n.as_f64(),
                Value::String(s) => s.trim().parse::<f64>().ok().filter(|n| n.is_finite()),
                _ => None,
            };
            number
                .and_then(serde_json::Number::from_f64)
                .map(Value::Number)
                .ok_or_else(|| format!("'{}' must be a number", field.key))
        }
        ExpectedOutputType::List => match raw {
            Value::Array(_) => Ok(raw.clone()),
            _ => Err(format!("'{}' must be a list", field.key)),
        },
        ExpectedOutputType::Choice => {
            let choice = js_string(raw);
            if let Some(options) = &field.options
                && !options.contains(&choice)
            {
                return Err(format!(
                    "'{}' must be one of {}",
                    field.key,
                    serde_json::to_string(options).unwrap_or_else(|_| "[]".to_string())
                ));
            }
            Ok(Value::String(choice))
        }
    }
}

/// JS `String(value)` for the scalar shapes a choice can arrive as.
pub(crate) fn js_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => n
            .as_f64()
            .map(crate::tokens::value::js_number_string)
            .unwrap_or_else(|| n.to_string()),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".to_string(),
        other => other.to_string(),
    }
}

/// Scans left to right tracking brace depth (string-aware, so a `}` inside a
/// quoted value never miscounts), collecting complete top-level `{...}`
/// spans; candidates are tried from the end (Node extractLastJsonObject).
fn extract_last_json_object(text: &str) -> Option<Map<String, Value>> {
    for candidate in collect_top_level_objects(text).iter().rev() {
        if let Ok(Value::Object(object)) = serde_json::from_str::<Value>(candidate) {
            return Some(object);
        }
    }
    None
}

fn collect_top_level_objects(text: &str) -> Vec<&str> {
    let mut candidates = Vec::new();
    let mut depth = 0usize;
    let mut start = None;
    let mut in_string = false;
    let mut escaped = false;
    for (i, ch) in text.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '{' => {
                if depth == 0 {
                    start = Some(i);
                }
                depth += 1;
            }
            '}' if depth > 0 => {
                depth -= 1;
                if depth == 0
                    && let Some(s) = start.take()
                {
                    candidates.push(&text[s..=i]);
                }
            }
            _ => {}
        }
    }
    candidates
}

// PORT STATUS: packages/core/src/automations/verbs/expects.ts (118 lines)
// confidence: high
// todos: 0
// notes: number coercion via parse::<f64> mirrors JS Number(raw) for the
//        strings agents actually emit; Infinity/NaN are rejected either way.
