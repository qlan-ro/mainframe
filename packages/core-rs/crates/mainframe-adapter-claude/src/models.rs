//! The Claude model catalog: the static fallback list, the older-but-still-active
//! models Mainframe offers on top of the CLI's own picker, and the context-window
//! reconciliation applied to a live probe.
//!
//! Ported from `packages/core/src/plugins/builtin/claude/adapter.ts`.

use std::collections::{HashMap, HashSet};

use mainframe_types::adapter::{AdapterModel, EffortLevel};

pub const DEFAULT_CONTEXT_WINDOW: i64 = 200_000;
pub const EXTENDED_CONTEXT_WINDOW: i64 = 1_000_000;

// Effort ladders, named for the rung they reach. The CLI gates them with three
// capability flags — `effort` (low/medium/high), `max_effort`, `xhigh_effort` —
// so read a model's ladder off that registry, never off its family: Sonnet 5
// carries `xhigh_effort` and Opus 4.6 does not.
const EFFORTS_TO_XHIGH: &[EffortLevel] = &[
    EffortLevel::Low,
    EffortLevel::Medium,
    EffortLevel::High,
    EffortLevel::Xhigh,
    EffortLevel::Max,
];
const EFFORTS_TO_MAX: &[EffortLevel] = &[
    EffortLevel::Low,
    EffortLevel::Medium,
    EffortLevel::High,
    EffortLevel::Max,
];
const EFFORTS_TO_HIGH: &[EffortLevel] = &[EffortLevel::Low, EffortLevel::Medium, EffortLevel::High];

struct ModelSpec {
    id: &'static str,
    label: &'static str,
    description: Option<&'static str>,
    context_window: i64,
    efforts: &'static [EffortLevel],
    /// `/fast` — Opus 5, 4.8 and 4.7 only.
    fast: bool,
    /// Adaptive thinking — Claude 4.6 and later.
    adaptive: bool,
}

/// What the CLI itself offers. `default` is an alias the CLI resolves to the
/// user's tier default at spawn time; a successful probe replaces this whole list.
const CURRENT_MODELS: &[ModelSpec] = &[
    ModelSpec {
        id: "default",
        label: "Default - Opus 5",
        description: Some("Opus 5 with 1M context"),
        context_window: EXTENDED_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_XHIGH,
        fast: true,
        adaptive: true,
    },
    ModelSpec {
        id: "claude-opus-5",
        label: "Opus 5",
        description: None,
        context_window: EXTENDED_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_XHIGH,
        fast: true,
        adaptive: true,
    },
    ModelSpec {
        id: "claude-fable-5",
        label: "Fable 5",
        description: None,
        context_window: EXTENDED_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_XHIGH,
        fast: false,
        adaptive: true,
    },
    // Window live-verified 2026-07-07: the CLI's get_context_usage reports
    // maxTokens 967,000 for claude-sonnet-5 (1M minus the CLI's reserve).
    ModelSpec {
        id: "claude-sonnet-5",
        label: "Sonnet 5",
        description: None,
        context_window: EXTENDED_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_XHIGH,
        fast: false,
        adaptive: true,
    },
    ModelSpec {
        id: "claude-haiku-4-5-20251001",
        label: "Haiku 4.5",
        description: None,
        context_window: DEFAULT_CONTEXT_WINDOW,
        efforts: &[],
        fast: false,
        adaptive: false,
    },
];

/// Models the API still serves that the CLI's picker hides. Checked against
/// <https://platform.claude.com/docs/en/about-claude/model-deprecations> on
/// 2026-07-29 — a retired id must never appear here, the API answers it with a
/// 404. Windows and effort ladders come from the CLI's own model registry
/// (v2.1.220): Opus 4.8 and 4.7 are `native_1m`, everything below them is 200k
/// unless asked for with the `[1m]` suffix.
const OLDER_MODELS: &[ModelSpec] = &[
    ModelSpec {
        id: "claude-opus-4-8",
        label: "Opus 4.8",
        description: None,
        context_window: EXTENDED_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_XHIGH,
        fast: true,
        adaptive: true,
    },
    ModelSpec {
        id: "claude-opus-4-7",
        label: "Opus 4.7",
        description: None,
        context_window: EXTENDED_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_XHIGH,
        fast: true,
        adaptive: true,
    },
    ModelSpec {
        id: "claude-opus-4-6",
        label: "Opus 4.6",
        description: None,
        context_window: DEFAULT_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_MAX,
        fast: false,
        adaptive: true,
    },
    ModelSpec {
        id: "claude-sonnet-4-6",
        label: "Sonnet 4.6",
        description: None,
        context_window: DEFAULT_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_MAX,
        fast: false,
        adaptive: true,
    },
    ModelSpec {
        id: "claude-opus-4-5-20251101",
        label: "Opus 4.5",
        description: None,
        context_window: DEFAULT_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_HIGH,
        fast: false,
        adaptive: false,
    },
    ModelSpec {
        id: "claude-sonnet-4-5-20250929",
        label: "Sonnet 4.5",
        description: None,
        context_window: DEFAULT_CONTEXT_WINDOW,
        efforts: &[],
        fast: false,
        adaptive: false,
    },
    ModelSpec {
        id: "claude-opus-4-1-20250805",
        label: "Opus 4.1",
        description: Some("Retires August 5, 2026"),
        context_window: DEFAULT_CONTEXT_WINDOW,
        efforts: &[],
        fast: false,
        adaptive: false,
    },
];

fn build(spec: &ModelSpec, is_older: bool) -> AdapterModel {
    AdapterModel {
        id: spec.id.to_string(),
        label: spec.label.to_string(),
        description: spec.description.map(str::to_string),
        resolved_model: None,
        context_window: Some(spec.context_window),
        is_default: (spec.id == "default").then_some(true),
        is_older: is_older.then_some(true),
        supported_efforts: (!spec.efforts.is_empty()).then(|| spec.efforts.to_vec()),
        default_effort: None,
        supports_fast: spec.fast.then_some(true),
        supports_ultracode: spec.efforts.contains(&EffortLevel::Xhigh).then_some(true),
        supports_adaptive_thinking: spec.adaptive.then_some(true),
        supports_personality: None,
    }
}

/// Static fallback catalog (`getFallbackModels`), used until a probe lands and
/// whenever one fails.
pub fn claude_models() -> Vec<AdapterModel> {
    CURRENT_MODELS
        .iter()
        .map(|spec| build(spec, false))
        .chain(older_models())
        .collect()
}

pub fn older_models() -> Vec<AdapterModel> {
    OLDER_MODELS.iter().map(|spec| build(spec, true)).collect()
}

/// The probe is authoritative for what the CLI offers, but its picker hides
/// older models the API still serves. Append every entry of [`older_models`] the
/// probe didn't surface — matched on the id *and* on the concrete id an alias
/// resolves to, so a probed `sonnet` doesn't list `claude-sonnet-5` twice.
pub fn merge_older_models(probed: Vec<AdapterModel>) -> Vec<AdapterModel> {
    let mut covered: HashSet<String> = HashSet::new();
    for model in &probed {
        covered.insert(base_id(&model.id));
        if let Some(resolved) = &model.resolved_model {
            covered.insert(base_id(resolved));
        }
    }
    let mut merged = probed;
    merged.extend(
        older_models()
            .into_iter()
            .filter(|model| !covered.contains(&base_id(&model.id))),
    );
    merged
}

/// `claude-opus-5[1m]` and `claude-opus-5` are the same model to the picker.
fn base_id(id: &str) -> String {
    let lower = id.to_lowercase();
    lower.strip_suffix("[1m]").unwrap_or(&lower).to_string()
}

fn has_extended_window_suffix(id: &str) -> bool {
    id.to_lowercase().ends_with("[1m]")
}

/// `/\b1m\b|1m context/i` on a description.
fn description_hints_extended(description: &str) -> bool {
    let lower = description.to_lowercase();
    if lower.contains("1m context") {
        return true;
    }
    // `\b1m\b` — "1m" bounded by non-word chars.
    let chars: Vec<char> = lower.chars().collect();
    let n = chars.len();
    let is_word = |c: char| c.is_ascii_alphanumeric() || c == '_';
    let mut i = 0;
    while i + 2 <= n {
        if chars[i] == '1' && chars[i + 1] == 'm' {
            let before_ok = i == 0 || !is_word(chars[i - 1]);
            let after_ok = i + 2 >= n || !is_word(chars[i + 2]);
            if before_ok && after_ok {
                return true;
            }
        }
        i += 1;
    }
    false
}

/// Reconcile probed entries with the static catalog so known IDs retain their
/// authoritative window, unknown IDs ending in "[1m]" (on the entry id OR its own
/// `resolvedModel` — the CLI puts the suffix on either side, e.g.
/// `claude-fable-5[1m]` resolves to a bare `claude-fable-5`) get the extended
/// window, and everything else falls back to a description sniff before the 200k
/// default. `default_resolved_model` is kept for callers probing legacy payloads
/// where only the "default" entry carried a resolution.
pub fn enrich_with_context_window(
    probed: Vec<AdapterModel>,
    default_resolved_model: Option<&str>,
) -> Vec<AdapterModel> {
    let static_windows: HashMap<String, i64> = claude_models()
        .into_iter()
        .filter_map(|model| model.context_window.map(|w| (model.id, w)))
        .collect();

    probed
        .into_iter()
        .map(|model| enrich_one(model, &static_windows, default_resolved_model))
        .collect()
}

fn enrich_one(
    mut model: AdapterModel,
    static_windows: &HashMap<String, i64>,
    default_resolved_model: Option<&str>,
) -> AdapterModel {
    // TS `if (model.contextWindow) return model;` — truthy (present & nonzero).
    if model.context_window.filter(|&w| w != 0).is_some() {
        return model;
    }
    // model.resolvedModel ?? (id === 'default' ? defaultResolvedModel : undefined)
    let resolved: Option<String> = model.resolved_model.clone().or_else(|| {
        if model.id == "default" {
            default_resolved_model.map(str::to_string)
        } else {
            None
        }
    });
    let resolved_ref = resolved.as_deref();
    if has_extended_window_suffix(&model.id)
        || resolved_ref
            .map(has_extended_window_suffix)
            .unwrap_or(false)
    {
        model.context_window = Some(EXTENDED_CONTEXT_WINDOW);
        return model;
    }
    // staticById.get(id)?.contextWindow ?? (resolved && staticById.get(resolved)?.contextWindow)
    let from_static = static_windows
        .get(&model.id)
        .copied()
        .or_else(|| resolved_ref.and_then(|r| static_windows.get(r).copied()));
    if let Some(w) = from_static {
        model.context_window = Some(w);
        return model;
    }
    model.context_window = Some(
        if model
            .description
            .as_deref()
            .map(description_hints_extended)
            .unwrap_or(false)
        {
            EXTENDED_CONTEXT_WINDOW
        } else {
            DEFAULT_CONTEXT_WINDOW
        },
    );
    model
}

#[cfg(test)]
mod tests {
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

    // These port probe-context-window.test.ts's enrichment assertions. The TS
    // harness drives them through a mocked `ClaudeAdapter.probeModels()`, which is
    // exactly `enrich_with_context_window(result.models, result.resolvedModel)`;
    // called directly here since the adapter struct is deferred (above).

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
    fn falls_back_to_description_sniff_for_unknown_ids() {
        let mut big = probed("claude-future-1m");
        big.description = Some("Future model with 1M context".to_string());
        let mut small = probed("claude-future-small");
        small.description = Some("Faster everyday model".to_string());
        let out = enrich_with_context_window(vec![big, small], None);
        assert_eq!(window_of(&out, "claude-future-1m"), Some(1_000_000));
        assert_eq!(window_of(&out, "claude-future-small"), Some(200_000));
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

    // Translated assertion-for-assertion from the new adapter-enrich.test.ts cases
    // (each probed entry carries its own resolvedModel).
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
}
