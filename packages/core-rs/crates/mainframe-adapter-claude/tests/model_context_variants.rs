#![allow(clippy::unwrap_used)]

use mainframe_adapter_claude::{models::enrich_with_context_window, probe_models::map_model_info};
use mainframe_types::adapter::AdapterModel;
use serde_json::json;

fn probed(id: &str, resolved: &str) -> AdapterModel {
    map_model_info(&json!({
        "value": id,
        "displayName": "Opus",
        "resolvedModel": resolved,
        "supportedEffortLevels": ["medium", "high"]
    }))
}

fn window(models: &[AdapterModel], id: &str) -> Option<i64> {
    models
        .iter()
        .find(|model| model.id == id)
        .and_then(|model| model.context_window)
}

#[test]
fn opus_55_has_a_native_1m_base_alias() {
    let models = enrich_with_context_window(vec![probed("opus[1m]", "claude-opus-5-5[1m]")], None);
    assert_eq!(window(&models, "opus"), Some(1_000_000));
    assert_eq!(window(&models, "opus[1m]"), Some(1_000_000));
    let base = models.iter().find(|model| model.id == "opus").unwrap();
    assert_eq!(base.resolved_model.as_deref(), Some("claude-opus-5-5"));
    assert_eq!(base.label, "Opus 5.5");
}

#[test]
fn older_known_model_exposes_its_200k_base_beside_1m() {
    let models = enrich_with_context_window(vec![probed("opus[1m]", "claude-opus-4-6[1m]")], None);
    assert_eq!(window(&models, "opus"), Some(200_000));
    assert_eq!(window(&models, "opus[1m]"), Some(1_000_000));
}

#[test]
fn unknown_extended_model_does_not_invent_a_base_context_size() {
    let models =
        enrich_with_context_window(vec![probed("future[1m]", "claude-future-99[1m]")], None);
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].id, "future[1m]");
    assert_eq!(models[0].context_window, Some(1_000_000));
}

#[test]
fn existing_context_variants_keep_their_reported_sizes_and_metadata() {
    let mut base = probed("opus", "claude-opus-5-5");
    base.label = "Account-specific Opus".into();
    base.context_window = Some(500_000);
    let mut extended = probed("opus[1m]", "claude-opus-5-5[1m]");
    extended.context_window = Some(900_000);
    let expected = vec![extended, base];
    assert_eq!(enrich_with_context_window(expected.clone(), None), expected);
}

#[test]
fn inheritance_does_not_hide_a_known_explicit_base_variant() {
    let models = enrich_with_context_window(
        vec![
            probed("default", "claude-opus-4-6"),
            probed("opus[1m]", "claude-opus-4-6"),
        ],
        None,
    );
    assert_eq!(window(&models, "opus"), Some(200_000));
    assert_eq!(window(&models, "opus[1m]"), Some(1_000_000));
}

#[test]
fn unknown_unsuffixed_models_do_not_advertise_a_guessed_context_window() {
    let raw = map_model_info(&json!({"value": "claude-custom", "displayName": "Custom"}));
    let alias = probed("custom", "claude-custom");
    let models = enrich_with_context_window(vec![raw, alias], None);
    assert_eq!(models.len(), 2);
    assert!(models.iter().all(|model| model.context_window.is_none()));
}

#[test]
fn reported_description_sizes_override_static_metadata_without_matching_marketing_numbers() {
    for (description, expected) in [
        ("Opus 5.5 with 250K context · Available", Some(250_000)),
        ("Custom with 1.5M context", Some(1_500_000)),
        ("Custom with 1M context", Some(1_000_000)),
        ("Handles 1M requests daily", None),
    ] {
        let entry = map_model_info(&json!({
            "value": "custom",
            "description": description,
            "resolvedModel": if description.starts_with("Opus") { "claude-opus-5-5" } else { "claude-custom" }
        }));
        assert_eq!(
            enrich_with_context_window(vec![entry], None)[0].context_window,
            expected,
            "{description}"
        );
    }
}

#[test]
fn explicit_context_size_wins_over_the_description_and_registry() {
    let mut entry = map_model_info(&json!({
        "value": "opus", "description": "Opus 5.5 with 250K context",
        "resolvedModel": "claude-opus-5-5"
    }));
    entry.context_window = Some(500_000);
    assert_eq!(
        enrich_with_context_window(vec![entry], None)[0].context_window,
        Some(500_000)
    );
}

#[test]
fn an_unknown_inherited_resolution_has_no_static_context_window() {
    let models = enrich_with_context_window(vec![probed("default", "claude-custom")], None);
    assert_eq!(models[0].context_window, None);
}
