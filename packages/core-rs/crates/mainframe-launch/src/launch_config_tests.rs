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
    let result = parse_launch_config(&json!({ "version": "1", "configurations": [] }), &env(&[]));
    let err = result.unwrap_err();
    assert!(
        err.to_string()
            .contains("At least one configuration is required")
    );
}
