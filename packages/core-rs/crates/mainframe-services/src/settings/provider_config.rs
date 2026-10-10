use mainframe_types::settings::ProviderConfig;
use serde_json::{Map, Value};

/// Reads provider settings through the real database or a test fake.
pub trait SettingsReader {
    fn get(&self, ns: &str, key: &str) -> Option<String>;
}

impl SettingsReader for mainframe_db::DatabaseManager {
    fn get(&self, ns: &str, key: &str) -> Option<String> {
        // db.settings.get is `string | null`; a DB error maps to None here.
        self.settings.get(ns, key).ok().flatten()
    }
}

const FIELDS: [&str; 12] = [
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
    "cliproxySmallFastModel",
];

pub fn get_provider_config(db: &impl SettingsReader, adapter_id: &str) -> ProviderConfig {
    let mut cfg: Map<String, Value> = Map::new();
    for f in FIELDS {
        if let Some(v) = db.get("provider", &format!("{adapter_id}.{f}")) {
            cfg.insert(f.to_string(), Value::String(v));
        }
    }
    // Enum fields deserialize from their wire strings. An unparseable value
    // falls back to an empty config.
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
