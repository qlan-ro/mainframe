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
#[path = "provider_update_tests.rs"]
mod tests;
