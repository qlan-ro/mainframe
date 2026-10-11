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

// Allowed executables: common package managers + node. No shell operators.
// The trailing alternative
// `[a-zA-Z0-9_\-./]+` makes any operator-free path acceptable, so the guard is
// really "no `;`, `|`, or `&`, and only path-safe characters".
fn is_safe_executable(value: &str) -> bool {
    if value.contains(';') || value.contains('|') || value.contains('&') {
        return false;
    }
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

    let runtime_executable = match obj.get("runtimeExecutable").and_then(Value::as_str) {
        Some(v) if !v.is_empty() => {
            if is_safe_executable(v) {
                v.to_string()
            } else {
                issues
                    .push("runtimeExecutable must be a safe executable name (no shell operators)");
                v.to_string()
            }
        }
        _ => {
            issues.push("runtimeExecutable must be a non-empty string");
            String::new()
        }
    };

    // runtimeArgs: array of strings, optional, default [].
    let runtime_args = match obj.get("runtimeArgs") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(items)) => {
            let mut args = Vec::with_capacity(items.len());
            for arg in items {
                match arg.as_str() {
                    Some(s) => args.push(s.to_string()),
                    None => issues.push("runtimeArgs must be an array of strings"),
                }
            }
            args
        }
        Some(_) => {
            issues.push("runtimeArgs must be an array of strings");
            Vec::new()
        }
    };

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

    let preview = match obj.get("preview") {
        None | Some(Value::Null) => None,
        Some(Value::Bool(b)) => Some(*b),
        Some(_) => {
            issues.push("preview must be a boolean");
            None
        }
    };

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

/// A number, string, or null (default null). A JSON number passes through
/// unchecked (its positivity is never validated);
/// a string is `parseInt`-ed and must be a positive integer; `null`/absent → None.
fn parse_port(value: Option<&Value>) -> Result<Option<i64>, &'static str> {
    const MESSAGE: &str = "port must be a positive integer or null";
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => Ok(n
            .as_i64()
            .or_else(|| n.as_f64().map(|f| f as i64))
            .or(Some(0))),
        Some(Value::String(s)) => match parse_int_prefix(s) {
            Some(parsed) if parsed > 0 => Ok(Some(parsed)),
            _ => Err(MESSAGE),
        },
        Some(_) => Err(MESSAGE),
    }
}

/// JS `parseInt(value, 10)`: skip leading ASCII whitespace, take an optional
/// sign and the leading run of decimal digits. Empty digit run → `None` (NaN).
fn parse_int_prefix(value: &str) -> Option<i64> {
    let trimmed = value.trim_start();
    let mut chars = trimmed.chars().peekable();
    let mut digits = String::new();
    if let Some(&sign @ ('+' | '-')) = chars.peek() {
        digits.push(sign);
        chars.next();
    }
    while let Some(&c) = chars.peek() {
        if c.is_ascii_digit() {
            digits.push(c);
            chars.next();
        } else {
            break;
        }
    }
    let has_digit = digits.chars().any(|c| c.is_ascii_digit());
    if !has_digit {
        return None;
    }
    digits.parse::<i64>().ok()
}

/// `z.string().url().nullable().optional().default(null)`. Without a URL crate
/// the check is a light `scheme://host` shape; `null`/absent → None.
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
// real URL parser would also reject bare hosts, missing authority, etc. No test
// exercises URL rejection yet.
fn looks_like_url(value: &str) -> bool {
    if let Some(idx) = value.find("://") {
        idx > 0 && value.len() > idx + 3 && !value.chars().any(char::is_whitespace)
    } else {
        false
    }
}

/// `z.record(keyRegex, z.coerce.string())`. Keys must match
/// `^[A-Za-z_][A-Za-z0-9_]*$`; values are coerced to strings.
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn env(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    #[test]
    fn invalid_configs_join_every_issue_in_check_order() {
        let err = parse_launch_config(
            &json!({
                "configurations": [{
                    "name": "",
                    "runtimeExecutable": "npm; rm",
                    "runtimeArgs": [],
                    "port": "abc",
                    "url": "nope",
                    "env": { "1BAD": "x" }
                }]
            }),
            &env(&[]),
        )
        .unwrap_err();
        assert_eq!(
            err.to_string(),
            "version must be a string, name must be a non-empty string, \
             runtimeExecutable must be a safe executable name (no shell operators), \
             port must be a positive integer or null, url must be a valid URL, \
             env key must be letters, digits, or underscores"
        );
        assert_eq!(
            parse_launch_config(&json!([]), &env(&[])).unwrap_err(),
            LaunchConfigError::NotAnObject
        );
        assert_eq!(
            LaunchConfigError::NotAnObject.to_string(),
            "Expected object"
        );
    }

    #[test]
    fn expands_variables_in_env_values() {
        let result = parse_launch_config(
            &json!({
                "version": "1",
                "configurations": [{
                    "name": "test",
                    "runtimeExecutable": "node",
                    "runtimeArgs": ["index.js"],
                    "port": null,
                    "env": { "PORT": "${TEST_PORT:-9999}" },
                }],
            }),
            &env(&[]),
        )
        .unwrap();
        let cfg_env = result.configurations[0].env.as_ref().unwrap();
        assert_eq!(cfg_env.get("PORT").map(String::as_str), Some("9999"));
    }

    #[test]
    fn coerces_string_port_to_number_after_expansion() {
        let result = parse_launch_config(
            &json!({
                "version": "1",
                "configurations": [{
                    "name": "test",
                    "runtimeExecutable": "node",
                    "runtimeArgs": [],
                    "port": "${PORT:-3000}",
                }],
            }),
            &env(&[]),
        )
        .unwrap();
        assert_eq!(result.configurations[0].port, Some(3000));
    }

    #[test]
    fn fails_on_non_numeric_port_after_expansion() {
        let result = parse_launch_config(
            &json!({
                "version": "1",
                "configurations": [{
                    "name": "test",
                    "runtimeExecutable": "node",
                    "runtimeArgs": [],
                    "port": "${PORT:-abc}",
                }],
            }),
            &env(&[]),
        );
        assert!(result.is_err());
    }

    #[test]
    fn resolves_env_vars_from_provided_env() {
        let result = parse_launch_config(
            &json!({
                "version": "1",
                "configurations": [{
                    "name": "test",
                    "runtimeExecutable": "node",
                    "runtimeArgs": [],
                    "port": "${MY_PORT}",
                }],
            }),
            &env(&[("MY_PORT", "4000")]),
        )
        .unwrap();
        assert_eq!(result.configurations[0].port, Some(4000));
    }

    #[test]
    fn returns_error_for_unresolved_variable() {
        let result = parse_launch_config(
            &json!({
                "version": "1",
                "configurations": [{
                    "name": "test",
                    "runtimeExecutable": "node",
                    "runtimeArgs": [],
                    "port": "${UNSET_VAR}",
                }],
            }),
            &env(&[]),
        );
        let err = result.unwrap_err();
        assert!(err.to_string().contains("Unresolved variable 'UNSET_VAR'"));
    }

    #[test]
    fn still_accepts_numeric_port_backward_compat() {
        let result = parse_launch_config(
            &json!({
                "version": "1",
                "configurations": [{
                    "name": "test",
                    "runtimeExecutable": "node",
                    "runtimeArgs": [],
                    "port": 8080,
                }],
            }),
            &env(&[]),
        )
        .unwrap();
        assert_eq!(result.configurations[0].port, Some(8080));
    }

    #[test]
    fn rejects_executable_with_shell_operators() {
        let result = parse_launch_config(
            &json!({
                "version": "1",
                "configurations": [{
                    "name": "test",
                    "runtimeExecutable": "node; rm -rf /",
                    "runtimeArgs": [],
                    "port": null,
                }],
            }),
            &env(&[]),
        );
        let err = result.unwrap_err();
        assert!(err.to_string().contains("safe executable name"));
    }

    #[test]
    fn rejects_more_than_one_preview_configuration() {
        let result = parse_launch_config(
            &json!({
                "version": "1",
                "configurations": [
                    { "name": "a", "runtimeExecutable": "node", "runtimeArgs": [], "port": null, "preview": true },
                    { "name": "b", "runtimeExecutable": "node", "runtimeArgs": [], "port": null, "preview": true },
                ],
            }),
            &env(&[]),
        );
        let err = result.unwrap_err();
        assert!(
            err.to_string()
                .contains("At most one configuration may have preview: true")
        );
    }

    #[test]
    fn rejects_empty_configurations() {
        let result =
            parse_launch_config(&json!({ "version": "1", "configurations": [] }), &env(&[]));
        let err = result.unwrap_err();
        assert!(
            err.to_string()
                .contains("At least one configuration is required")
        );
    }
}
