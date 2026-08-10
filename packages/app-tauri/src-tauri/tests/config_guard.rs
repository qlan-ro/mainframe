//! Guards the security concessions the packaged-QA config overlay is allowed to make.
//!
//! `tauri.conf.json` must stay locked down forever; `tauri.qa.conf.json` (added in
//! a later task) may relax exactly `script-src` to add `'unsafe-inline'` and
//! `withGlobalTauri`, and nothing else. See docs/plans/2026-08-10-todo-318-packaged-tauri-qa-bridge-plan.md.

use serde_json::Value;
use std::collections::BTreeSet;
use std::fs;

const DEFAULT_CONFIG_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tauri.conf.json");
const QA_CONFIG_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tauri.qa.conf.json");

fn load_config(path: &str) -> Value {
    let raw = fs::read_to_string(path)
        .unwrap_or_else(|err| panic!("failed to read config at {path}: {err}"));
    serde_json::from_str(&raw)
        .unwrap_or_else(|err| panic!("failed to parse config at {path} as JSON: {err}"))
}

/// Extracts the `script-src` directive from a CSP string. A CSP has multiple
/// `;`-separated directives; other directives (e.g. `style-src`) may legally
/// contain tokens like `'unsafe-inline'` that this guard must not see.
fn script_src_directive(csp: &str) -> &str {
    csp.split(';')
        .map(str::trim)
        .find(|directive| *directive == "script-src" || directive.starts_with("script-src "))
        .unwrap_or_else(|| panic!("csp has no script-src directive: {csp}"))
}

fn security_object(config: &Value) -> &serde_json::Map<String, Value> {
    config["app"]["security"]
        .as_object()
        .expect("app.security must be an object")
}

#[test]
fn default_config_script_src_is_locked_down() {
    let config = load_config(DEFAULT_CONFIG_PATH);
    let csp = config["app"]["security"]["csp"]
        .as_str()
        .expect("app.security.csp must be a string");
    let script_src = script_src_directive(csp);

    assert!(
        script_src.contains("'self'"),
        "script-src must allow 'self': {script_src}"
    );
    for forbidden in ["'unsafe-inline'", "'unsafe-eval'", "nonce-", "sha256-"] {
        assert!(
            !script_src.contains(forbidden),
            "script-src must not contain {forbidden}: {script_src}"
        );
    }
}

#[test]
fn default_config_disables_global_tauri() {
    let config = load_config(DEFAULT_CONFIG_PATH);
    assert_eq!(config["app"]["withGlobalTauri"], Value::Bool(false));
}

#[test]
fn default_config_has_no_csp_modification_escape_hatch() {
    let config = load_config(DEFAULT_CONFIG_PATH);
    assert!(!security_object(&config).contains_key("dangerousDisableAssetCspModification"));
}

#[test]
fn qa_overlay_enables_global_tauri() {
    let config = load_config(QA_CONFIG_PATH);
    assert_eq!(config["app"]["withGlobalTauri"], Value::Bool(true));
}

#[test]
fn qa_overlay_relaxes_only_script_src_to_allow_inline() {
    let config = load_config(QA_CONFIG_PATH);
    let csp = config["app"]["security"]["csp"]
        .as_str()
        .expect("app.security.csp must be a string");
    let script_src = script_src_directive(csp);

    assert!(
        script_src.contains("'self'"),
        "script-src must still allow 'self': {script_src}"
    );
    assert!(
        script_src.contains("'unsafe-inline'"),
        "script-src must allow 'unsafe-inline' for the bridge's inline helper: {script_src}"
    );
    assert!(
        !script_src.contains("'unsafe-eval'"),
        "script-src must not also add 'unsafe-eval': {script_src}"
    );
}

#[test]
fn qa_overlay_has_no_csp_modification_escape_hatch() {
    let config = load_config(QA_CONFIG_PATH);
    assert!(!security_object(&config).contains_key("dangerousDisableAssetCspModification"));
}

#[test]
fn qa_overlay_carries_only_app_config() {
    let config = load_config(QA_CONFIG_PATH);
    let top_level = config
        .as_object()
        .expect("qa overlay must be a JSON object");
    let keys: BTreeSet<&str> = top_level.keys().map(String::as_str).collect();
    let expected: BTreeSet<&str> = ["$schema", "app"].into_iter().collect();

    assert_eq!(
        keys, expected,
        "qa overlay must carry only $schema and app, found: {top_level:?}"
    );
}

// Named without the `mcp_bridge` substring: Task 3's verify filters on that
// substring across every test target (`cargo test --features mcp-bridge-qa
// mcp_bridge`), and this test must fail under that invocation (mcp-bridge-qa
// implies mcp-bridge) — a name match would make it collateral damage.
#[test]
fn plain_build_has_no_bridge_feature_enabled() {
    assert!(!cfg!(feature = "mcp-bridge"));
}

#[cfg(feature = "mcp-bridge-qa")]
#[test]
fn qa_feature_implies_the_dev_bridge_feature() {
    assert!(cfg!(feature = "mcp-bridge"));
}
