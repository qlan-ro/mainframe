//! `ProviderConfigUpdate`: the `PUT /api/settings/providers/{id}` patch, and the
//! one list of persisted provider field names (`provider` rows are keyed
//! `<adapterId>.<field>`). Both come from a single field table so the patch,
//! the field list and the reader in `mainframe-services` cannot drift apart.

use serde::Deserialize;
use serde::de::DeserializeOwned;

use super::{BoolString, ExecutionMode, Personality, ReasoningSummary};
use crate::adapter::EffortLevel;

macro_rules! provider_config_update {
    ($($field:ident => $wire:literal),+ $(,)?) => {
        /// Patch body for one provider (`ProviderConfigUpdate` in
        /// `packages/types/src/settings.ts`). Fields carry the raw wire string:
        /// absent leaves the row alone, `""` clears it, anything else is stored
        /// once [`ProviderConfigUpdate::is_valid`] accepts it.
        #[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
        pub struct ProviderConfigUpdate {
            $(
                #[serde(rename = $wire)]
                pub $field: Option<String>,
            )+
        }

        /// Wire names of every persisted `ProviderConfig` field
        /// (`resolvedExecutable` is computed, never stored).
        pub const PROVIDER_CONFIG_FIELDS: &[&str] = &[$($wire),+];

        impl ProviderConfigUpdate {
            /// `(wire name, value)` for every field that is present in the patch.
            #[must_use]
            pub fn into_present_fields(self) -> Vec<(&'static str, String)> {
                let mut present = Vec::new();
                $(
                    if let Some(value) = self.$field {
                        present.push(($wire, value));
                    }
                )+
                present
            }
        }
    };
}

provider_config_update! {
    default_model => "defaultModel",
    default_mode => "defaultMode",
    default_plan_mode => "defaultPlanMode",
    executable_path => "executablePath",
    system_prompt => "systemPrompt",
    default_effort => "defaultEffort",
    default_fast => "defaultFast",
    default_ultracode => "defaultUltracode",
    default_adaptive_thinking => "defaultAdaptiveThinking",
    personality => "personality",
    reasoning_summary => "reasoningSummary",
    cliproxy_small_fast_model => "cliproxySmallFastModel",
}

impl ProviderConfigUpdate {
    /// Whether every present enum-valued field names a member of its enum.
    /// `defaultMode` and `defaultPlanMode` must be set to a member; the tuning
    /// fields also accept the `""` clear sentinel. Free-text fields (model,
    /// path, prompt, small-fast model) are always valid.
    #[must_use]
    pub fn is_valid(&self) -> bool {
        is_member::<ExecutionMode>(&self.default_mode, false)
            && is_member::<BoolString>(&self.default_plan_mode, false)
            && is_member::<EffortLevel>(&self.default_effort, true)
            && is_member::<BoolString>(&self.default_fast, true)
            && is_member::<BoolString>(&self.default_ultracode, true)
            && is_member::<BoolString>(&self.default_adaptive_thinking, true)
            && is_member::<Personality>(&self.personality, true)
            && is_member::<ReasoningSummary>(&self.reasoning_summary, true)
    }
}

/// `true` when `value` is absent, is `""` and `clearable`, or deserializes as `T`.
fn is_member<T: DeserializeOwned>(value: &Option<String>, clearable: bool) -> bool {
    match value.as_deref() {
        None => true,
        Some("") => clearable,
        Some(v) => serde_json::from_value::<T>(serde_json::Value::String(v.to_string())).is_ok(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::{ProviderConfig, ResolvedExecutable, ResolvedExecutableSource};

    /// Every `ProviderConfig` field populated. A struct literal, so adding a
    /// field to `ProviderConfig` fails to compile here until this test (and the
    /// field table) learn about it.
    fn full_provider_config() -> ProviderConfig {
        ProviderConfig {
            default_model: Some("m".into()),
            default_mode: Some(ExecutionMode::Auto),
            default_plan_mode: Some(BoolString::True),
            executable_path: Some("/p".into()),
            system_prompt: Some("s".into()),
            resolved_executable: Some(ResolvedExecutable {
                path: "/p".into(),
                source: ResolvedExecutableSource::Config,
                valid: true,
                version: None,
            }),
            default_effort: Some(EffortLevel::High),
            default_fast: Some(BoolString::False),
            default_ultracode: Some(BoolString::False),
            default_adaptive_thinking: Some(BoolString::False),
            personality: Some(Personality::None),
            reasoning_summary: Some(ReasoningSummary::Auto),
            cliproxy_small_fast_model: Some("f".into()),
        }
    }

    #[test]
    fn field_list_names_every_stored_provider_config_field() {
        let value = serde_json::to_value(full_provider_config()).unwrap();
        let mut wire: Vec<&str> = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .filter(|k| *k != "resolvedExecutable")
            .collect();
        wire.sort_unstable();
        let mut fields = PROVIDER_CONFIG_FIELDS.to_vec();
        fields.sort_unstable();
        assert_eq!(fields, wire);
    }

    #[test]
    fn deserializes_wire_names_and_lists_only_present_fields() {
        let update: ProviderConfigUpdate = serde_json::from_str(
            r#"{"defaultModel":"opus","personality":"","reasoningSummary":"auto","unknown":"x"}"#,
        )
        .unwrap();
        assert_eq!(
            update.into_present_fields(),
            vec![
                ("defaultModel", "opus".to_string()),
                ("personality", String::new()),
                ("reasoningSummary", "auto".to_string()),
            ]
        );
    }

    #[test]
    fn validity_follows_each_fields_enum_and_clear_rule() {
        let valid = |json: &str| {
            serde_json::from_str::<ProviderConfigUpdate>(json)
                .unwrap()
                .is_valid()
        };
        assert!(valid(
            r#"{"defaultMode":"acceptEdits","defaultPlanMode":"false"}"#
        ));
        assert!(valid(
            r#"{"defaultEffort":"","defaultFast":"","personality":"friendly"}"#
        ));
        assert!(valid(
            r#"{"defaultModel":"","executablePath":"anything at all"}"#
        ));
        assert!(!valid(r#"{"defaultMode":""}"#));
        assert!(!valid(r#"{"defaultMode":"plan"}"#));
        assert!(!valid(r#"{"defaultPlanMode":""}"#));
        assert!(!valid(r#"{"defaultEffort":"extreme"}"#));
        assert!(!valid(r#"{"defaultUltracode":"TRUE"}"#));
        assert!(!valid(r#"{"reasoningSummary":"verbose"}"#));
    }
}
