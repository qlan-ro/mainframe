//! The Claude model catalog: the static fallback list, the older-but-still-active
//! models Mainframe offers on top of the CLI's own picker, and the context-window
//! reconciliation applied to a live probe.

use std::collections::{HashMap, HashSet};

use mainframe_types::adapter::{AdapterModel, EffortLevel};

mod context_description;
mod context_variants;

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
    /// Verified `/fast` capability from the CLI registry.
    fast: bool,
    /// Adaptive thinking — Claude 4.6 and later.
    adaptive: bool,
}

/// Fallback entries; `default` inherits the configured CLI model.
const CURRENT_MODELS: &[ModelSpec] = &[
    ModelSpec {
        id: "default",
        label: "Use CLI setting",
        description: Some("Let Claude Code choose the model."),
        context_window: EXTENDED_CONTEXT_WINDOW,
        efforts: EFFORTS_TO_XHIGH,
        fast: true,
        adaptive: true,
    },
    ModelSpec {
        id: "claude-opus-5-5",
        label: "Opus 5.5",
        description: None,
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
        group: None,
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
pub(crate) fn claude_models() -> Vec<AdapterModel> {
    CURRENT_MODELS
        .iter()
        .map(|spec| build(spec, false))
        .chain(older_models())
        .collect()
}

pub(crate) fn older_models() -> Vec<AdapterModel> {
    OLDER_MODELS.iter().map(|spec| build(spec, true)).collect()
}

/// The probe is authoritative for what the CLI offers, but its picker hides
/// older models the API still serves. Append every entry of [`older_models`] the
/// probe didn't surface — matched on the id *and* on the concrete id an alias
/// resolves to, so a probed `sonnet` doesn't list `claude-sonnet-5` twice.
pub(crate) fn merge_older_models(probed: Vec<AdapterModel>) -> Vec<AdapterModel> {
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

/// Preserve reported sizes, then infer from suffixes, descriptions or known metadata.
/// `default_resolved_model` supports legacy responses without per-entry resolutions.
pub fn enrich_with_context_window(
    probed: Vec<AdapterModel>,
    default_resolved_model: Option<&str>,
) -> Vec<AdapterModel> {
    let static_windows: HashMap<String, i64> = claude_models()
        .into_iter()
        .filter(|model| model.id != "default")
        .filter_map(|model| model.context_window.map(|w| (model.id, w)))
        .collect();

    let enriched = probed
        .into_iter()
        .map(|model| enrich_one(model, &static_windows, default_resolved_model))
        .collect();
    context_variants::with_known_base_variants(enriched)
}

fn enrich_one(
    mut model: AdapterModel,
    static_windows: &HashMap<String, i64>,
    default_resolved_model: Option<&str>,
) -> AdapterModel {
    if model.context_window.filter(|&w| w != 0).is_some() {
        return model;
    }
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
    model.context_window = model
        .description
        .as_deref()
        .and_then(context_description::context_window)
        .or_else(|| static_windows.get(&model.id).copied())
        .or_else(|| resolved_ref.and_then(|r| static_windows.get(r).copied()));
    model
}

#[cfg(test)]
#[path = "models_tests.rs"]
mod tests;
