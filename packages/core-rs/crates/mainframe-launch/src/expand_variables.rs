//! Ported from `src/launch/expand-variables.ts`.
//!
//! Recursive `${VAR}` / `${VAR:-default}` substitution plus leading-`~`
//! expansion over an arbitrary JSON value. Non-string scalars pass through
//! unchanged. The TS uses a global regex
//! (`/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g`); no `regex` crate is
//! allowlisted, so the same grammar is hand-scanned left-to-right with JS
//! `String.replace` semantics: a `${` that does not form a valid reference is
//! emitted literally and scanning resumes one byte later.

use std::collections::HashMap;

use serde_json::{Map, Value};

/// Expand every string in `raw`, recursing into arrays and objects. Errors with
/// the TS message when a referenced variable is unset and carries no default.
pub fn expand_variables(raw: &Value, env: &HashMap<String, String>) -> Result<Value, String> {
    match raw {
        Value::String(s) => Ok(Value::String(expand_string(s, env)?)),
        Value::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                out.push(expand_variables(item, env)?);
            }
            Ok(Value::Array(out))
        }
        Value::Object(map) => {
            let mut out = Map::new();
            for (key, value) in map {
                out.insert(key.clone(), expand_variables(value, env)?);
            }
            Ok(Value::Object(out))
        }
        other => Ok(other.clone()),
    }
}

fn expand_string(value: &str, env: &HashMap<String, String>) -> Result<String, String> {
    let expanded = replace_vars(value, env)?;

    // Tilde expansion: `~` alone or a leading `~/` become the home directory.
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    if expanded == "~" {
        return Ok(home);
    }
    if let Some(rest) = expanded.strip_prefix("~/") {
        return Ok(format!("{home}/{rest}"));
    }
    Ok(expanded)
}

fn replace_vars(value: &str, env: &HashMap<String, String>) -> Result<String, String> {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    loop {
        let Some(pos) = rest.find("${") else {
            out.push_str(rest);
            return Ok(out);
        };
        out.push_str(&rest[..pos]);
        let candidate = &rest[pos..];
        match parse_var(candidate) {
            Some((name, default, consumed)) => {
                let resolved = match env.get(&name) {
                    Some(env_value) => env_value.clone(),
                    None => match default {
                        Some(default_value) => default_value,
                        None => {
                            return Err(format!(
                                "Unresolved variable '{name}' in launch.json. Set it in your environment or provide a default: ${{{name}:-<value>}}"
                            ));
                        }
                    },
                };
                out.push_str(&resolved);
                rest = &candidate[consumed..];
            }
            None => {
                // Not a valid reference — emit the `$` literally and resume just
                // past it, mirroring the global regex advancing by one.
                out.push('$');
                rest = &candidate[1..];
            }
        }
    }
}

/// Parse a `${NAME}` or `${NAME:-default}` reference at the start of `s` (which
/// begins with `${`). Returns the name, the optional default, and the number of
/// bytes consumed. `None` if the text is not a valid reference.
fn parse_var(s: &str) -> Option<(String, Option<String>, usize)> {
    let body = s.get(2..)?;

    let mut name_len = 0usize;
    for (idx, ch) in body.char_indices() {
        let ok = if idx == 0 {
            ch == '_' || ch.is_ascii_alphabetic()
        } else {
            ch == '_' || ch.is_ascii_alphanumeric()
        };
        if ok {
            name_len = idx + ch.len_utf8();
        } else {
            break;
        }
    }
    if name_len == 0 {
        return None;
    }
    let name = body[..name_len].to_string();
    let after_name = &body[name_len..];

    if let Some(after_brace) = after_name.strip_prefix('}') {
        let _ = after_brace;
        // 2 (`${`) + name + 1 (`}`)
        return Some((name, None, 2 + name_len + 1));
    }
    if let Some(after_marker) = after_name.strip_prefix(":-") {
        let brace = after_marker.find('}')?;
        let default = after_marker[..brace].to_string();
        // 2 (`${`) + name + 2 (`:-`) + default + 1 (`}`)
        return Some((name, Some(default), 2 + name_len + 2 + brace + 1));
    }
    None
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
    fn replaces_var_from_env() {
        let result =
            expand_variables(&json!({ "port": "${PORT}" }), &env(&[("PORT", "3000")])).unwrap();
        assert_eq!(result, json!({ "port": "3000" }));
    }

    #[test]
    fn replaces_var_default_with_env_value_when_set() {
        let result = expand_variables(
            &json!({ "port": "${PORT:-8080}" }),
            &env(&[("PORT", "3000")]),
        )
        .unwrap();
        assert_eq!(result, json!({ "port": "3000" }));
    }

    #[test]
    fn uses_default_when_env_var_is_unset() {
        let result = expand_variables(&json!({ "port": "${PORT:-8080}" }), &env(&[])).unwrap();
        assert_eq!(result, json!({ "port": "8080" }));
    }

    #[test]
    fn errors_on_unresolved_variable_without_default() {
        let err = expand_variables(&json!({ "port": "${PORT}" }), &env(&[])).unwrap_err();
        assert!(err.contains("Unresolved variable 'PORT' in launch.json"));
    }

    #[test]
    fn handles_multiple_expansions_in_one_string() {
        let result = expand_variables(
            &json!({ "url": "http://${HOST:-localhost}:${PORT:-3000}/api" }),
            &env(&[]),
        )
        .unwrap();
        assert_eq!(result, json!({ "url": "http://localhost:3000/api" }));
    }

    #[test]
    fn expands_variables_in_arrays() {
        let result =
            expand_variables(&json!({ "args": ["--port", "${PORT:-3000}"] }), &env(&[])).unwrap();
        assert_eq!(result, json!({ "args": ["--port", "3000"] }));
    }

    #[test]
    fn recurses_into_nested_objects() {
        let result = expand_variables(
            &json!({ "env": { "DAEMON_PORT": "${PORT:-31416}" } }),
            &env(&[]),
        )
        .unwrap();
        assert_eq!(result, json!({ "env": { "DAEMON_PORT": "31416" } }));
    }

    #[test]
    fn passes_through_numbers_booleans_and_null_unchanged() {
        let result = expand_variables(
            &json!({ "port": 3000, "preview": true, "url": null }),
            &env(&[]),
        )
        .unwrap();
        assert_eq!(
            result,
            json!({ "port": 3000, "preview": true, "url": null })
        );
    }

    #[test]
    fn expands_tilde_in_values() {
        let result = expand_variables(&json!({ "dir": "~/data" }), &env(&[])).unwrap();
        let dir = result["dir"].as_str().unwrap();
        assert!(dir.starts_with('/') && dir.ends_with("/data"));
    }

    #[test]
    fn expands_tilde_combined_with_variable_expansion() {
        let result =
            expand_variables(&json!({ "dir": "~/${SUBDIR:-mainframe}" }), &env(&[])).unwrap();
        let dir = result["dir"].as_str().unwrap();
        assert!(dir.starts_with('/') && dir.ends_with("/mainframe"));
    }

    #[test]
    fn handles_empty_default() {
        let result = expand_variables(&json!({ "val": "${EMPTY:-}" }), &env(&[])).unwrap();
        assert_eq!(result, json!({ "val": "" }));
    }

    #[test]
    fn leaves_strings_without_patterns_unchanged() {
        let result = expand_variables(&json!({ "name": "Core Daemon" }), &env(&[])).unwrap();
        assert_eq!(result, json!({ "name": "Core Daemon" }));
    }
}

// PORT STATUS: src/launch/expand-variables.ts (32 lines)
// confidence: high
// todos: 0
// notes: global regex → hand-scanned `${NAME(:-default)?}` grammar with JS
// String.replace semantics (an invalid `${` is emitted literally, scan resumes
// +1). env is a HashMap (TS `Record<string,string|undefined>`); an empty-string
// value is present (Some("")) and wins over a default, matching `!= null`.
// homedir → dirs::home_dir(); `~/rest` → `${home}/rest` mirrors `home +
// slice(1)`. All 13 expand-variables.test.ts cases translated.
