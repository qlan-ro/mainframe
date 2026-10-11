use super::*;
use crate::settings::test_support::FailingSettings;
use mainframe_types::adapter::EffortLevel;
use mainframe_types::settings::BoolString;
use mainframe_types::settings_kv::MemorySettings;

#[tokio::test]
async fn assembles_flat_provider_settings_into_typed_config() {
    let kv = MemorySettings::default()
        .with("provider", "claude.defaultModel", "opus")
        .with("provider", "claude.defaultEffort", "high")
        .with("provider", "claude.defaultFast", "true")
        .with("provider", "claude.titleBinary", "not-a-config-field")
        .with("provider", "codex.defaultModel", "gpt");
    let cfg = get_provider_config(&kv, "claude").await;
    assert_eq!(
        cfg,
        ProviderConfig {
            default_model: Some("opus".into()),
            default_effort: Some(EffortLevel::High),
            default_fast: Some(BoolString::True),
            ..ProviderConfig::default()
        }
    );
}

#[tokio::test]
async fn returns_empty_config_when_no_settings_present() {
    let kv = MemorySettings::default().with("general", "codex.defaultModel", "x");
    assert_eq!(
        get_provider_config(&kv, "codex").await,
        ProviderConfig::default()
    );
}

#[tokio::test]
async fn an_out_of_enum_value_yields_the_empty_config() {
    let kv = MemorySettings::default()
        .with("provider", "claude.defaultModel", "opus")
        .with("provider", "claude.personality", "grumpy");
    assert_eq!(
        get_provider_config(&kv, "claude").await,
        ProviderConfig::default()
    );
}

#[tokio::test]
async fn a_store_failure_yields_the_empty_config() {
    assert_eq!(
        get_provider_config(&FailingSettings, "claude").await,
        ProviderConfig::default()
    );
}
