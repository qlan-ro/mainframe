//! Variable-expansion + validation for a raw `launch.json`. There is no
//! allowlisted schema crate, so the rules are checked by hand with fixed
//! `message` strings. Structural type errors are collected and joined with
//! `, `. Validation runs on the already-expanded value, so an
//! unresolved-variable error surfaces first.

use std::collections::HashMap;

use mainframe_types::launch::{LaunchConfig, LaunchConfiguration};
use serde_json::Value;

use crate::expand_variables::{UnresolvedVariable, expand_variables};

/// Why a `launch.json` is unusable. The launch routes answer with the text
/// verbatim, so it is wire contract.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LaunchConfigError {
    #[error(transparent)]
    Unresolved(#[from] UnresolvedVariable),
    #[error("Expected object")]
    NotAnObject,
    /// Every schema rule the config breaks, in check order, joined with `, `.
    #[error("{}", .0.join(", "))]
    Invalid(Vec<&'static str>),
}

/// Parse and validate a raw launch config. Returns the typed config, or the
/// unresolved-variable error from expansion, or the joined validation issues.
pub fn parse_launch_config(
    data: &Value,
    env: &HashMap<String, String>,
) -> Result<LaunchConfig, LaunchConfigError> {
    let expanded = expand_variables(data, env)?;

    let obj = expanded.as_object().ok_or(LaunchConfigError::NotAnObject)?;

    let mut issues: Vec<&'static str> = Vec::new();

    let version = match obj.get("version").and_then(Value::as_str) {
        Some(v) => v.to_string(),
        None => {
            issues.push("version must be a string");
            String::new()
        }
    };

    let mut configurations: Vec<LaunchConfiguration> = Vec::new();
    match obj.get("configurations") {
        Some(Value::Array(items)) => {
            if items.is_empty() {
                issues.push("At least one configuration is required");
            }
            for item in items {
                match parse_configuration(item) {
                    Ok(cfg) => configurations.push(cfg),
                    Err(mut errs) => issues.append(&mut errs),
                }
            }
        }
        _ => issues.push("At least one configuration is required"),
    }

    if configurations
        .iter()
        .filter(|c| c.preview == Some(true))
        .count()
        > 1
    {
        issues.push("At most one configuration may have preview: true");
    }

    if issues.is_empty() {
        Ok(LaunchConfig {
            version,
            configurations,
        })
    } else {
        Err(LaunchConfigError::Invalid(issues))
    }
}

/// Only path-safe characters, so no shell operator (`;`, `|`, `&`) can appear.
fn is_safe_executable(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '/'))
}

fn parse_configuration(item: &Value) -> Result<LaunchConfiguration, Vec<&'static str>> {
    let mut issues: Vec<&'static str> = Vec::new();

    let obj = match item.as_object() {
        Some(obj) => obj,
        None => return Err(vec!["configuration must be an object"]),
    };

    let name = match obj.get("name").and_then(Value::as_str) {
        Some(v) if !v.is_empty() => v.to_string(),
        _ => {
            issues.push("name must be a non-empty string");
            String::new()
        }
    };

    let runtime_executable = parse_runtime_executable(obj, &mut issues);

    let runtime_args = parse_runtime_args(obj, &mut issues);

    let port = match parse_port(obj.get("port")) {
        Ok(port) => port,
        Err(message) => {
            issues.push(message);
            None
        }
    };

    let url = match parse_url_field(obj.get("url")) {
        Ok(url) => url,
        Err(message) => {
            issues.push(message);
            None
        }
    };

    let preview = parse_preview(obj.get("preview"), &mut issues);

    let env = match parse_env(obj.get("env")) {
        Ok(env) => env,
        Err(mut errs) => {
            issues.append(&mut errs);
            None
        }
    };

    if issues.is_empty() {
        Ok(LaunchConfiguration {
            name,
            runtime_executable,
            runtime_args,
            port,
            url,
            preview,
            env,
        })
    } else {
        Err(issues)
    }
}

/// A TCP port (1–65535) given as a JSON integer or a decimal string, or
/// `null`/absent for none.
fn parse_port(value: Option<&Value>) -> Result<Option<i64>, &'static str> {
    const MESSAGE: &str = "port must be a positive integer or null";
    let port = match value {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::Number(n)) => n.as_u64().and_then(|n| u16::try_from(n).ok()),
        Some(Value::String(s)) => s.trim().parse::<u16>().ok(),
        Some(_) => None,
    };
    match port {
        Some(port) if port > 0 => Ok(Some(i64::from(port))),
        _ => Err(MESSAGE),
    }
}

/// A URL string, or `null`/absent for none. Without a URL crate the check is
/// a light `scheme://host` shape.
fn parse_url_field(value: Option<&Value>) -> Result<Option<String>, &'static str> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => {
            if looks_like_url(s) {
                Ok(Some(s.to_string()))
            } else {
                Err("url must be a valid URL")
            }
        }
        Some(_) => Err("url must be a valid URL"),
    }
}

// TODO: this shape check is permissive (`scheme://non-empty`, no whitespace); a
// real URL parser would also reject bare hosts, missing authority, etc.
fn looks_like_url(value: &str) -> bool {
    if let Some(idx) = value.find("://") {
        idx > 0 && value.len() > idx + 3 && !value.chars().any(char::is_whitespace)
    } else {
        false
    }
}

/// An object of env vars. Keys must match `^[A-Za-z_][A-Za-z0-9_]*$`;
/// scalar values are coerced to strings.
fn parse_env(value: Option<&Value>) -> Result<Option<HashMap<String, String>>, Vec<&'static str>> {
    let obj = match value {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::Object(obj)) => obj,
        Some(_) => return Err(vec!["env must be an object"]),
    };

    let mut issues: Vec<&'static str> = Vec::new();
    let mut out: HashMap<String, String> = HashMap::new();
    for (key, val) in obj {
        if !is_valid_env_key(key) {
            issues.push("env key must be letters, digits, or underscores");
            continue;
        }
        match coerce_string(val) {
            Some(coerced) => {
                out.insert(key.clone(), coerced);
            }
            None => issues.push("env value must be coercible to a string"),
        }
    }

    if issues.is_empty() {
        Ok(Some(out))
    } else {
        Err(issues)
    }
}

fn is_valid_env_key(key: &str) -> bool {
    let mut chars = key.chars();
    match chars.next() {
        Some(c) if c == '_' || c.is_ascii_alphabetic() => {}
        _ => return false,
    }
    chars.all(|c| c == '_' || c.is_ascii_alphanumeric())
}

fn coerce_string(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        Value::Null => Some("null".to_string()),
        _ => None,
    }
}

mod fields;
use fields::{parse_preview, parse_runtime_args, parse_runtime_executable};
#[cfg(test)]
#[path = "launch_config_tests.rs"]
mod tests;
