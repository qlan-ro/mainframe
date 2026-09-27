use mainframe_types::adapter::AdapterModel;

use super::{CURRENT_MODELS, OLDER_MODELS};

pub(super) fn with_known_base_variants(models: Vec<AdapterModel>) -> Vec<AdapterModel> {
    let mut result = Vec::new();
    for model in &models {
        if let Some(base) = known_base_variant(model)
            && !models.iter().chain(result.iter()).any(|entry| {
                entry.id != "default"
                    && (entry.id == base.id
                        || (!entry.id.ends_with("[1m]")
                            && (Some(&entry.id) == base.resolved_model.as_ref()
                                || entry.resolved_model == base.resolved_model)))
            })
        {
            result.push(base);
        }
        result.push(model.clone());
    }
    result
}

fn known_base_variant(model: &AdapterModel) -> Option<AdapterModel> {
    let id = model.id.strip_suffix("[1m]")?;
    let resolved = model.resolved_model.as_deref().unwrap_or(&model.id);
    let resolved = resolved.strip_suffix("[1m]").unwrap_or(resolved);
    let spec = CURRENT_MODELS
        .iter()
        .chain(OLDER_MODELS)
        .find(|spec| spec.id == resolved)?;
    let mut base = model.clone();
    base.id = id.to_owned();
    base.resolved_model = Some(resolved.to_owned());
    base.label = spec.label.to_owned();
    base.description = spec.description.map(str::to_owned);
    base.context_window = Some(spec.context_window);
    Some(base)
}
