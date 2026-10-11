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
    assert_eq!(
        err.to_string(),
        "Unresolved variable 'PORT' in launch.json. Set it in your environment or provide a default: ${PORT:-<value>}"
    );
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
    let result = expand_variables(&json!({ "dir": "~/${SUBDIR:-mainframe}" }), &env(&[])).unwrap();
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
