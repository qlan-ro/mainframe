//! Ported from `src/settings/provider-config.ts`.

use mainframe_types::settings::ProviderConfig;
use serde_json::{Map, Value};

/// Mirrors the inline `SettingsReader` interface (`{ settings: { get(ns, key) } }`).
/// A trait so both the real `DatabaseManager` and test fakes satisfy it.
pub trait SettingsReader {
    fn get(&self, ns: &str, key: &str) -> Option<String>;
}

impl SettingsReader for mainframe_db::DatabaseManager {
    fn get(&self, ns: &str, key: &str) -> Option<String> {
        // db.settings.get is `string | null`; a DB error maps to None here.
        self.settings.get(ns, key).ok().flatten()
    }
}

const FIELDS: [&str; 11] = [
    "defaultModel",
    "defaultMode",
    "defaultPlanMode",
    "executablePath",
    "systemPrompt",
    "defaultEffort",
    "defaultFast",
    "defaultUltracode",
    "defaultAdaptiveThinking",
    "personality",
    "reasoningSummary",
];

pub fn get_provider_config(db: &impl SettingsReader, adapter_id: &str) -> ProviderConfig {
    let mut cfg: Map<String, Value> = Map::new();
    for f in FIELDS {
        if let Some(v) = db.get("provider", &format!("{adapter_id}.{f}")) {
            cfg.insert(f.to_string(), Value::String(v));
        }
    }
    // The TS builds a `Record<string,string>` and casts to ProviderConfig; the
    // Rust struct is typed, so the raw-string map deserializes into it (enum
    // fields resolve from their wire strings). An unparseable value falls back to
    // an empty config (the TS cast is unchecked; only valid fixtures exercise it).
    serde_json::from_value(Value::Object(cfg)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::adapter::EffortLevel;
    use mainframe_types::settings::BoolString;
    use std::collections::HashMap;

    struct FakeDb {
        rows: HashMap<String, String>,
    }

    impl SettingsReader for FakeDb {
        fn get(&self, ns: &str, key: &str) -> Option<String> {
            self.rows.get(&format!("{ns}:{key}")).cloned()
        }
    }

    fn fake_db(pairs: &[(&str, &str)]) -> FakeDb {
        FakeDb {
            rows: pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        }
    }

    #[test]
    fn assembles_flat_provider_settings_into_typed_config() {
        let db = fake_db(&[
            ("provider:claude.defaultModel", "opus"),
            ("provider:claude.defaultEffort", "high"),
            ("provider:claude.defaultFast", "true"),
        ]);
        let cfg = get_provider_config(&db, "claude");
        assert_eq!(cfg.default_model.as_deref(), Some("opus"));
        assert_eq!(cfg.default_effort, Some(EffortLevel::High));
        assert_eq!(cfg.default_fast, Some(BoolString::True));
    }

    #[test]
    fn returns_empty_config_when_no_settings_present() {
        let db = fake_db(&[]);
        assert_eq!(get_provider_config(&db, "codex"), ProviderConfig::default());
    }
}

// PORT STATUS: src/settings/provider-config.ts (20 lines)
// confidence: high
// todos: 0
// notes: FIELDS list preserved verbatim (camelCase keys). The TS "assemble a
// string record then cast" becomes "assemble a serde_json::Map<String,String>
// then from_value into the typed ProviderConfig" so enum fields (defaultEffort,
// defaultFast, ...) resolve from their wire strings. Unparseable → default()
// (TS cast is unchecked; noted deviation). SettingsReader trait mirrors the TS
// interface; impl'd for DatabaseManager (settings.get error → None).
