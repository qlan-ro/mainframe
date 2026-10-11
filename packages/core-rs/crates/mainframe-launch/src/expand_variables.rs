//! Recursive `${VAR}` / `${VAR:-default}` substitution plus leading-`~`
//! expansion over an arbitrary JSON value. Non-string scalars pass through
//! unchanged. The grammar is the global regex
//! (`/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g`); no `regex` crate is
//! allowlisted, so it is hand-scanned left-to-right with JS
//! `String.replace` semantics: a `${` that does not form a valid reference is
//! emitted literally and scanning resumes one byte later.

use std::collections::HashMap;

use serde_json::{Map, Value};

/// A `${NAME}` reference with no value in the environment and no default.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error(
    "Unresolved variable '{0}' in launch.json. Set it in your environment or provide a default: ${{{0}:-<value>}}"
)]
pub struct UnresolvedVariable(pub String);

/// Expand every string in `raw`, recursing into arrays and objects. Errors
/// when a referenced variable is unset and carries no default.
pub fn expand_variables(
    raw: &Value,
    env: &HashMap<String, String>,
) -> Result<Value, UnresolvedVariable> {
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

fn expand_string(value: &str, env: &HashMap<String, String>) -> Result<String, UnresolvedVariable> {
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

fn replace_vars(value: &str, env: &HashMap<String, String>) -> Result<String, UnresolvedVariable> {
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
                        None => return Err(UnresolvedVariable(name)),
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
#[path = "expand_variables_tests.rs"]
mod tests;
