//! The Claude model catalog: the static fallback list, the older-but-still-active
//! models Mainframe offers on top of the CLI's own picker, and the context-window
//! reconciliation applied to a live probe.

use std::collections::{HashMap, HashSet};

use mainframe_types::adapter::{AdapterModel, EffortLevel};

#[path = "models_catalog.rs"]
mod catalog;
use catalog::{CURRENT_MODELS, ModelSpec, OLDER_MODELS};

mod context_description;
mod context_variants;

pub const DEFAULT_CONTEXT_WINDOW: i64 = 200_000;
pub const EXTENDED_CONTEXT_WINDOW: i64 = 1_000_000;

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
