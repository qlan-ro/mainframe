//! A2 structured agent outputs: the output contract appended to the prompt,
//! the corrective-retry message, and the parse/validate/coerce pass over the
//! agent's final message. Every string here crosses the wire (prompts, retry
//! messages, step errors).

use serde_json::{Map, Value};

use crate::domain::{ExpectedOutput, ExpectedOutputType};
use crate::tokens::value::js_string;

pub(crate) fn build_output_contract(expects: &[ExpectedOutput]) -> String {
    format!(
        "\n\nEnd your final message with a JSON object matching this shape (and nothing after it): {}",
        describe_shape(expects)
    )
}

pub(crate) fn build_correction_message(
    reason: &ExpectedOutputError,
    expects: &[ExpectedOutput],
) -> String {
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

/// Why an agent's answer does not satisfy the step's declared outputs. The
/// text is the plain-language reason the correction message and the step
/// error quote.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub(crate) enum ExpectedOutputError {
    #[error("no JSON object found in the response")]
    NoJsonObject,
    #[error("missing key '{0}'")]
    MissingKey(String),
    /// `expected` reads "a string", "a number" or "a list".
    #[error("'{key}' must be {expected}")]
    WrongType { key: String, expected: &'static str },
    /// `options` is the JSON array of allowed choices.
    #[error("'{key}' must be one of {options}")]
    NotAChoice { key: String, options: String },
}

/// Extracts the LAST top-level JSON object from `text` and validates every
/// declared key, coercing per type.
pub(crate) fn parse_expected(
    text: &str,
    expects: &[ExpectedOutput],
) -> Result<Map<String, Value>, ExpectedOutputError> {
    let json = extract_last_json_object(text).ok_or(ExpectedOutputError::NoJsonObject)?;

    let mut outputs = Map::new();
    for field in expects {
        let raw = json
            .get(&field.key)
            .ok_or_else(|| ExpectedOutputError::MissingKey(field.key.clone()))?;
        outputs.insert(field.key.clone(), coerce_field(raw, field)?);
    }
    Ok(outputs)
}

fn coerce_field(raw: &Value, field: &ExpectedOutput) -> Result<Value, ExpectedOutputError> {
    let wrong_type = |expected| ExpectedOutputError::WrongType {
        key: field.key.clone(),
        expected,
    };
    match field.output_type {
        ExpectedOutputType::Text => match raw {
            Value::String(_) => Ok(raw.clone()),
            _ => Err(wrong_type("a string")),
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
                .ok_or_else(|| wrong_type("a number"))
        }
        ExpectedOutputType::List => match raw {
            Value::Array(_) => Ok(raw.clone()),
            _ => Err(wrong_type("a list")),
        },
        ExpectedOutputType::Choice => {
            let choice = js_string(raw);
            if let Some(options) = &field.options
                && !options.contains(&choice)
            {
                return Err(ExpectedOutputError::NotAChoice {
                    key: field.key.clone(),
                    options: serde_json::to_string(options).unwrap_or_else(|_| "[]".to_string()),
                });
            }
            Ok(Value::String(choice))
        }
    }
}

/// Scans left to right tracking brace depth (string-aware, so a `}` inside a
/// quoted value never miscounts), collecting complete top-level `{...}`
/// spans; candidates are tried from the end.
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
