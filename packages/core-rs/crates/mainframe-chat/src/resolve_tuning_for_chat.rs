use mainframe_services::settings::get_provider_config;
use mainframe_types::adapter::AdapterModel;
use mainframe_types::chat::{Chat, ResolvedTuning, SessionTuning};
use mainframe_types::settings_kv::SettingsKv;

use crate::resolve_tuning::{ProviderTuningDefaults, resolve_tuning};

pub async fn resolve_tuning_for_chat(
    chat: &Chat,
    settings: &dyn SettingsKv,
    models: &[AdapterModel],
) -> ResolvedTuning {
    let model_id = chat.model.clone().unwrap_or_default();
    // Exact match → the adapter's default model (covers 'default'/alias/inherited model
    // ids that aren't literal catalog keys) → a capability-less stub as last resort.
    let model: AdapterModel = models
        .iter()
        .find(|m| m.id == model_id)
        .cloned()
        .or_else(|| models.iter().find(|m| m.is_default == Some(true)).cloned())
        .unwrap_or_else(|| AdapterModel {
            id: model_id.clone(),
            label: model_id.clone(),
            description: None,
            context_window: None,
            is_default: None,
            is_older: None,
            group: None,
            supported_efforts: None,
            default_effort: None,
            supports_fast: None,
            supports_ultracode: None,
            supports_adaptive_thinking: None,
            supports_personality: None,
            resolved_model: None,
        });
    let cfg = get_provider_config(settings, &chat.adapter_id).await;
    let provider = ProviderTuningDefaults {
        default_effort: cfg.default_effort,
        default_fast: cfg.default_fast,
        default_ultracode: cfg.default_ultracode,
        default_adaptive_thinking: cfg.default_adaptive_thinking,
    };
    resolve_tuning(
        &SessionTuning {
            effort: chat.tuning.effort,
            fast: chat.tuning.fast,
            ultracode: chat.tuning.ultracode,
            adaptive_thinking: chat.tuning.adaptive_thinking,
        },
        &provider,
        &model,
    )
}

#[cfg(test)]
#[path = "resolve_tuning_for_chat_tests.rs"]
mod tests;
