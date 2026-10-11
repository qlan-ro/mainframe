use super::*;

fn probed(id: &str) -> AdapterModel {
    AdapterModel {
        id: id.to_string(),
        label: id.to_string(),
        description: None,
        resolved_model: None,
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
    }
}

fn window_of(models: &[AdapterModel], id: &str) -> Option<i64> {
    models
        .iter()
        .find(|m| m.id == id)
        .and_then(|m| m.context_window)
}

// Context-window enrichment, driven through `enrich_with_context_window`
// directly rather than through a mocked model probe.

#[test]
fn preserves_context_window_from_static_catalog_for_known_ids() {
    let mut default = probed("default");
    default.is_default = Some(true);
    default.description = Some("Opus 4.7 with 1M context · Most capable".to_string());
    let out = enrich_with_context_window(
        vec![default, probed("claude-sonnet-4-6"), probed("sonnet[1m]")],
        None,
    );
    assert_eq!(window_of(&out, "default"), Some(1_000_000));
    assert_eq!(window_of(&out, "claude-sonnet-4-6"), Some(200_000));
    assert_eq!(window_of(&out, "sonnet[1m]"), Some(1_000_000));
}

#[test]
fn unknown_windows_require_a_description_hint() {
    let mut big = probed("claude-future-1m");
    big.description = Some("Future model with 1M context".to_string());
    let mut small = probed("claude-future-small");
    small.description = Some("Faster everyday model".to_string());
    let out = enrich_with_context_window(vec![big, small], None);
    assert_eq!(window_of(&out, "claude-future-1m"), Some(1_000_000));
    assert_eq!(window_of(&out, "claude-future-small"), None);
}

#[test]
fn respects_explicit_context_window_on_probed_entry() {
    let mut custom = probed("claude-custom");
    custom.context_window = Some(500_000);
    let out = enrich_with_context_window(vec![custom], None);
    assert_eq!(out[0].context_window, Some(500_000));
}

#[test]
fn stamps_default_window_from_resolved_model_without_description() {
    let mut default = probed("default");
    default.is_default = Some(true);
    let out = enrich_with_context_window(vec![default], Some("claude-fable-5[1m]"));
    assert_eq!(out[0].context_window, Some(1_000_000));
}

// Each probed entry carries its own resolvedModel.
fn probed_full(id: &str, description: &str, resolved: &str) -> AdapterModel {
    let mut m = probed(id);
    m.description = Some(description.to_string());
    m.resolved_model = Some(resolved.to_string());
    m
}

#[test]
fn infers_1m_from_a_non_default_entry_whose_own_resolved_model_carries_1m() {
    let probed = vec![
        probed_full(
            "opus[1m]",
            "Opus 4.8 with 1M context",
            "claude-opus-4-8[1m]",
        ),
        probed_full("my-alias", "Some model", "claude-something-9[1m]"),
    ];
    let enriched = enrich_with_context_window(probed, None);
    assert_eq!(enriched[0].context_window, Some(1_000_000));
    assert_eq!(enriched[1].context_window, Some(1_000_000));
}

#[test]
fn keeps_the_1m_id_suffix_authoritative_even_when_resolved_model_drops_it() {
    let probed = vec![probed_full(
        "claude-fable-5[1m]",
        "Fable 5",
        "claude-fable-5",
    )];
    assert_eq!(
        enrich_with_context_window(probed, None)[0].context_window,
        Some(1_000_000)
    );
}

#[test]
fn resolves_the_static_catalog_window_via_the_entry_resolved_model_for_alias_ids() {
    let probed = vec![probed_full("haiku", "Fastest", "claude-haiku-4-5-20251001")];
    assert_eq!(
        enrich_with_context_window(probed, None)[0].context_window,
        Some(200_000)
    );
}

#[test]
fn gives_claude_sonnet_5_the_extended_window_from_the_static_catalog() {
    let probed = vec![probed_full(
        "sonnet",
        "Efficient for routine tasks",
        "claude-sonnet-5",
    )];
    assert_eq!(
        enrich_with_context_window(probed, None)[0].context_window,
        Some(1_000_000)
    );
}

// ---- catalog + older-model merge ----

fn ids(models: &[AdapterModel]) -> Vec<String> {
    models.iter().map(|m| m.id.clone()).collect()
}

/// Retired ids are answered with a 404, so offering one is a broken picker row.
#[test]
fn the_catalog_lists_no_retired_model() {
    let retired = [
        "claude-opus-4-20250514",
        "claude-sonnet-4-20250514",
        "claude-3-7-sonnet-20250219",
        "claude-3-5-sonnet-20241022",
        "claude-3-5-haiku-20241022",
        "claude-3-haiku-20240307",
    ];
    for id in retired {
        assert!(!ids(&claude_models()).contains(&id.to_string()), "{id}");
    }
}

#[test]
fn older_models_are_flagged_and_current_ones_are_not() {
    assert!(older_models().iter().all(|m| m.is_older == Some(true)));
    let catalog = claude_models();
    let opus5 = catalog.iter().find(|m| m.id == "claude-opus-5").unwrap();
    assert_eq!(opus5.is_older, None);
    assert_eq!(opus5.context_window, Some(EXTENDED_CONTEXT_WINDOW));
}

/// Pinned to the CLI's own model registry (v2.1.220): `context.window` /
/// `context.native_1m` and the `effort` / `max_effort` / `xhigh_effort`
/// capability flags. Family names don't predict either — Sonnet 5 reaches
/// xhigh, Opus 4.6 doesn't, and Opus 4.8/4.7 are natively 1M.
#[test]
fn model_windows_and_effort_ladders_match_the_cli_registry() {
    let catalog = claude_models();
    let spec = |id: &str| catalog.iter().find(|m| m.id == id).unwrap().clone();
    let top = |id: &str| spec(id).supported_efforts.map(|e| e.len());

    assert_eq!(
        spec("claude-opus-4-8").context_window,
        Some(EXTENDED_CONTEXT_WINDOW)
    );
    assert_eq!(
        spec("claude-opus-4-7").context_window,
        Some(EXTENDED_CONTEXT_WINDOW)
    );
    assert_eq!(
        spec("claude-opus-4-6").context_window,
        Some(DEFAULT_CONTEXT_WINDOW)
    );

    assert_eq!(spec("claude-sonnet-5").supports_ultracode, Some(true));
    assert_eq!(spec("claude-opus-4-6").supports_ultracode, None);
    assert_eq!(top("claude-opus-4-6"), Some(4));
    assert_eq!(top("claude-opus-4-5-20251101"), Some(3));
    assert_eq!(top("claude-sonnet-4-5-20250929"), None);
    assert_eq!(top("claude-opus-4-1-20250805"), None);

    for id in ["claude-opus-5", "claude-opus-4-8", "claude-opus-4-7"] {
        assert_eq!(spec(id).supports_fast, Some(true), "{id}");
    }
    for id in ["claude-fable-5", "claude-sonnet-5", "claude-opus-4-6"] {
        assert_eq!(spec(id).supports_fast, None, "{id}");
    }
}

#[test]
fn merge_appends_the_models_the_cli_picker_hides() {
    let merged = merge_older_models(vec![probed("default"), probed("haiku")]);
    let merged_ids = ids(&merged);
    assert_eq!(&merged_ids[..2], &["default", "haiku"]);
    assert!(merged_ids.contains(&"claude-opus-4-5-20251101".to_string()));
    assert!(merged_ids.contains(&"claude-opus-4-1-20250805".to_string()));
}

#[test]
fn merge_skips_an_older_model_the_probe_already_offers() {
    let merged = merge_older_models(vec![probed("claude-opus-4-6")]);
    assert_eq!(
        ids(&merged)
            .iter()
            .filter(|id| id.as_str() == "claude-opus-4-6")
            .count(),
        1
    );
}

/// The CLI's alias entries carry the concrete id in `resolvedModel`; matching on
/// it (and ignoring a `[1m]` suffix) is what keeps a model off the list twice.
#[test]
fn merge_matches_an_alias_by_its_resolved_model() {
    let merged = merge_older_models(vec![
        probed_full("opus", "Opus 4.6", "claude-opus-4-6"),
        probed_full("sonnet[1m]", "Sonnet 4.6", "claude-sonnet-4-6[1m]"),
    ]);
    let merged_ids = ids(&merged);
    assert!(!merged_ids.contains(&"claude-opus-4-6".to_string()));
    assert!(!merged_ids.contains(&"claude-sonnet-4-6".to_string()));
}

#[test]
fn merge_keeps_the_probed_entries_untouched() {
    let probed_entry = probed_full("default", "Opus 5", "claude-opus-5");
    let merged = merge_older_models(vec![probed_entry.clone()]);
    assert_eq!(merged[0], probed_entry);
}
