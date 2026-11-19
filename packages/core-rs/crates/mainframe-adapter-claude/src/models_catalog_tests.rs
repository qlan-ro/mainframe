use mainframe_types::adapter::EffortLevel;

use super::*;

fn tagline_probe() -> Vec<AdapterModel> {
    [
        (
            "default",
            "For your toughest challenges",
            "claude-fable-5-1",
        ),
        ("fable", "For your toughest challenges", "claude-fable-5-1"),
        ("sonnet", "For everyday tasks", "claude-sonnet-5-5"),
        ("haiku", "For quick answers", "claude-haiku-5-5"),
    ]
    .into_iter()
    .map(|(id, description, resolved)| probed_full(id, description, resolved))
    .collect()
}

#[test]
fn tagline_aliases_receive_registry_windows() {
    let enriched = enrich_with_context_window(tagline_probe(), None);
    assert_eq!(enriched.len(), 4);
    for model in enriched {
        assert_eq!(model.context_window, Some(1_000_000), "{}", model.id);
    }
}

#[test]
fn new_catalog_entries_match_registry_and_precede_previous_versions() {
    let catalog = claude_models();
    for (id, label, previous) in [
        ("claude-fable-5-1", "Fable 5.1", "claude-fable-5"),
        ("claude-sonnet-5-5", "Sonnet 5.5", "claude-sonnet-5"),
        ("claude-haiku-5-5", "Haiku 5.5", "claude-haiku-4-5-20251001"),
    ] {
        let index = catalog.iter().position(|m| m.id == id).unwrap();
        let model = &catalog[index];
        assert_eq!(model.label, label);
        assert_eq!(model.context_window, Some(1_000_000));
        assert_eq!(
            model.supported_efforts.as_deref(),
            Some(
                [
                    EffortLevel::Low,
                    EffortLevel::Medium,
                    EffortLevel::High,
                    EffortLevel::Xhigh,
                    EffortLevel::Max
                ]
                .as_slice()
            )
        );
        assert_eq!(model.supports_fast, None);
        assert_eq!(model.supports_adaptive_thinking, Some(true));
        assert_eq!(model.supports_ultracode, Some(true));
        assert_eq!(model.is_older, None);
        assert!(index < catalog.iter().position(|m| m.id == previous).unwrap());
    }
}

#[test]
fn merging_tagline_aliases_preserves_probe_without_concrete_duplicates() {
    let probe = tagline_probe();
    let merged = merge_older_models(probe.clone());
    assert_eq!(&merged[..4], probe.as_slice());
    for model in probe {
        assert_eq!(merged.iter().filter(|m| m.id == model.id).count(), 1);
        assert!(
            !merged
                .iter()
                .any(|m| Some(&m.id) == model.resolved_model.as_ref())
        );
    }
    let unique: HashSet<_> = merged.iter().map(|m| &m.id).collect();
    assert_eq!(unique.len(), merged.len());
}
