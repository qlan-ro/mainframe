//! Ported from `packages/core/src/plugins/security/manifest-validator.ts`.
//!
//! Hand-rolled equivalent of the Zod schema (no `zod`/`regex` crate in §8). The
//! validator is lenient about legacy UI zone names (`left-panel`, `right-tab`, …)
//! exactly as the Zod schema is; it only feeds the dropped on-disk load path in
//! v1, but the model is preserved so a WASM loader can reuse it.

use serde_json::Value;

use mainframe_types::plugin::PluginManifest;

const VALID_CAPABILITIES: [&str; 10] = [
    "storage",
    "ui:panels",
    "ui:notifications",
    "daemon:public-events",
    "chat:read",
    "chat:read:content",
    "chat:create",
    "adapters",
    "process:exec",
    "http:outbound",
];

const VALID_ZONES: [&str; 11] = [
    "fullview",
    "left-top",
    "left-bottom",
    "right-top",
    "right-bottom",
    "bottom-left",
    "bottom-right",
    // Legacy zone names accepted for backwards compatibility.
    "left-panel",
    "right-panel",
    "left-tab",
    "right-tab",
];

/// `validateManifest(raw)` — `Ok(manifest)` on success, `Err(joined_messages)`
/// on failure (messages joined with `; `, mirroring the Zod issue join).
pub fn validate_manifest(raw: &Value) -> Result<PluginManifest, String> {
    let mut issues: Vec<String> = Vec::new();

    // id — required, `^[a-z][a-z0-9-]*$`.
    match raw.get("id").and_then(Value::as_str) {
        Some(id) if is_valid_id(id) => {}
        Some(_) => issues.push("id must be lowercase alphanumeric with hyphens".to_string()),
        None => issues.push("id must be lowercase alphanumeric with hyphens".to_string()),
    }

    // name / version — non-empty strings.
    if !is_non_empty_string(raw.get("name")) {
        issues.push("name is required".to_string());
    }
    if !is_non_empty_string(raw.get("version")) {
        issues.push("version is required".to_string());
    }

    // capabilities — array of known capability strings.
    let capabilities = match raw.get("capabilities") {
        Some(Value::Array(items)) => {
            let mut caps = Vec::new();
            for item in items {
                match item.as_str() {
                    Some(s) if VALID_CAPABILITIES.contains(&s) => caps.push(s.to_string()),
                    _ => issues.push(format!("Invalid capability: {item}")),
                }
            }
            caps
        }
        _ => {
            issues.push("capabilities must be an array".to_string());
            Vec::new()
        }
    };

    // ui — optional single object or array of zone contributions.
    let contributions = collect_ui_contributions(raw.get("ui"), &mut issues);

    // superRefine: adapters capability requires the adapter field.
    if capabilities.iter().any(|c| c == "adapters") && !is_object(raw.get("adapter")) {
        issues
            .push("adapter field is required when \"adapters\" capability is declared".to_string());
    }
    // superRefine: declared ui zones require the ui:panels capability.
    if contributions > 0 && !capabilities.iter().any(|c| c == "ui:panels") {
        issues.push(
            "Manifest declares ui zone(s) but is missing the \"ui:panels\" capability".to_string(),
        );
    }

    if !issues.is_empty() {
        return Err(issues.join("; "));
    }

    // Build the typed manifest. `ui`/`adapter` deserialize best-effort: a legacy
    // zone name (valid on disk) does not fit the typed `UiZone` enum, so it lands
    // as `None` — the builtin path never reads it (it passes its own manifest).
    Ok(PluginManifest {
        id: string_field(raw, "id"),
        name: string_field(raw, "name"),
        version: string_field(raw, "version"),
        description: opt_string_field(raw, "description"),
        author: opt_string_field(raw, "author"),
        license: opt_string_field(raw, "license"),
        capabilities: raw
            .get("capabilities")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default(),
        ui: raw
            .get("ui")
            .and_then(|v| serde_json::from_value(v.clone()).ok()),
        adapter: raw
            .get("adapter")
            .and_then(|v| serde_json::from_value(v.clone()).ok()),
        commands: raw
            .get("commands")
            .and_then(|v| serde_json::from_value(v.clone()).ok()),
    })
}

fn is_valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn is_non_empty_string(value: Option<&Value>) -> bool {
    matches!(value.and_then(Value::as_str), Some(s) if !s.is_empty())
}

fn is_object(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::Object(_)))
}

/// Returns the number of UI zone contributions, pushing an issue for any invalid
/// zone. Accepts a single object, an array, or absent (`0`).
fn collect_ui_contributions(ui: Option<&Value>, issues: &mut Vec<String>) -> usize {
    let items: Vec<&Value> = match ui {
        None | Some(Value::Null) => return 0,
        Some(Value::Array(arr)) => arr.iter().collect(),
        Some(obj @ Value::Object(_)) => vec![obj],
        Some(_) => {
            issues.push("ui must be an object or an array".to_string());
            return 0;
        }
    };
    for item in &items {
        let zone_ok = item
            .get("zone")
            .and_then(Value::as_str)
            .is_some_and(|z| VALID_ZONES.contains(&z));
        let label_ok = item.get("label").and_then(Value::as_str).is_some();
        if !zone_ok || !label_ok {
            issues.push("Invalid ui zone contribution".to_string());
        }
    }
    items.len()
}

fn string_field(raw: &Value, key: &str) -> String {
    raw.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn opt_string_field(raw: &Value, key: &str) -> Option<String> {
    raw.get(key).and_then(Value::as_str).map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn accepts_valid_manifest() {
        let result = validate_manifest(&json!({
            "id": "todos", "name": "Todos", "version": "1.0.0",
            "capabilities": ["storage", "ui:panels"],
        }));
        assert!(result.is_ok());
    }

    #[test]
    fn rejects_uppercase_id() {
        let result = validate_manifest(
            &json!({ "id": "MyPlugin", "name": "x", "version": "1", "capabilities": [] }),
        );
        let err = result.unwrap_err();
        assert!(err.contains("id"));
    }

    #[test]
    fn rejects_unknown_capability() {
        let result = validate_manifest(
            &json!({ "id": "x", "name": "x", "version": "1", "capabilities": ["malware"] }),
        );
        assert!(result.is_err());
    }

    #[test]
    fn requires_adapter_field_for_adapters_capability() {
        let result = validate_manifest(
            &json!({ "id": "x", "name": "x", "version": "1", "capabilities": ["adapters"] }),
        );
        let err = result.unwrap_err();
        assert!(err.contains("adapter"));
    }

    #[test]
    fn accepts_adapters_with_adapter_field() {
        let result = validate_manifest(&json!({
            "id": "gemini", "name": "Gemini", "version": "1.0.0",
            "capabilities": ["adapters"],
            "adapter": { "binaryName": "gemini", "displayName": "Gemini CLI" },
        }));
        assert!(result.is_ok());
    }

    #[test]
    fn accepts_legacy_single_object_ui() {
        let result = validate_manifest(&json!({
            "id": "todos", "name": "Todos", "version": "1.0.0",
            "capabilities": ["ui:panels"],
            "ui": { "zone": "left-panel", "label": "Todos", "icon": "CheckSquare" },
        }));
        assert!(result.is_ok());
    }

    #[test]
    fn accepts_zoneid_ui() {
        let result = validate_manifest(&json!({
            "id": "todos", "name": "Todos", "version": "1.0.0",
            "capabilities": ["ui:panels"],
            "ui": { "zone": "right-top", "label": "Sidebar" },
        }));
        assert!(result.is_ok());
    }

    #[test]
    fn rejects_invalid_zone() {
        let result = validate_manifest(&json!({
            "id": "todos", "name": "Todos", "version": "1.0.0",
            "capabilities": ["ui:panels"],
            "ui": { "zone": "sidebar-primary", "label": "Todos" },
        }));
        assert!(result.is_err());
    }

    #[test]
    fn rejects_ui_zone_without_ui_panels() {
        let result = validate_manifest(&json!({
            "id": "test", "name": "Test", "version": "1.0.0",
            "capabilities": [],
            "ui": { "zone": "fullview", "label": "Test" },
        }));
        let err = result.unwrap_err();
        assert!(err.contains("ui:panels"));
    }

    #[test]
    fn accepts_array_ui() {
        let result = validate_manifest(&json!({
            "id": "todos", "name": "Todos", "version": "1.0.0",
            "capabilities": ["ui:panels"],
            "ui": [
                { "zone": "fullview", "label": "Kanban", "icon": "square-check" },
                { "zone": "right-top", "label": "Quick Add", "icon": "list-todo" },
            ],
        }));
        assert!(result.is_ok());
    }

    #[test]
    fn rejects_array_ui_with_invalid_zone() {
        let result = validate_manifest(&json!({
            "id": "todos", "name": "Todos", "version": "1.0.0",
            "capabilities": ["ui:panels"],
            "ui": [
                { "zone": "fullview", "label": "Kanban" },
                { "zone": "not-a-real-zone", "label": "Bad" },
            ],
        }));
        assert!(result.is_err());
    }

    #[test]
    fn rejects_array_ui_without_ui_panels() {
        let result = validate_manifest(&json!({
            "id": "todos", "name": "Todos", "version": "1.0.0",
            "capabilities": [],
            "ui": [{ "zone": "fullview", "label": "Kanban" }],
        }));
        let err = result.unwrap_err();
        assert!(err.contains("ui:panels"));
    }

    #[test]
    fn accepts_empty_array_ui_without_ui_panels() {
        let result = validate_manifest(&json!({
            "id": "todos", "name": "Todos", "version": "1.0.0",
            "capabilities": [],
            "ui": [],
        }));
        assert!(result.is_ok());
    }
}

// PORT STATUS: src/plugins/security/manifest-validator.ts
// confidence: high
// todos: 0
// notes: Zod schema hand-rolled (no zod/regex crate in §8). Legacy zone names
// accepted like the TS union. superRefine rules preserved (adapters⇒adapter,
// ui-zones⇒ui:panels). Error messages carry the same substrings the oracle
// asserts (`id`, `adapter`, `ui:panels`); issues joined with `; `. Feeds only the
// dropped on-disk load path in v1 (builtin path passes its own manifest).
