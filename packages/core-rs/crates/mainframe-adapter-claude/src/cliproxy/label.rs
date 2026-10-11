//! The two lines the picker shows for a proxy model. CLIProxyAPI publishes an id
//! (`gpt-5.6-sol`) and an owner (`openai`) — no display name, no blurb — so both lines are
//! formatted from those two facts. Anything more (context windows, what a model is good at)
//! would be invention: the catalog is open-ended, users alias their own models into it.

use super::order::{Tier, tier};

/// Acronyms the ids spell in lowercase. Everything else title-cases.
const ACRONYMS: &[&str] = &["gpt", "glm", "api", "ai", "vl", "tts"];

/// Owners whose own spelling a title-case pass gets wrong.
const PROVIDER_NAMES: &[(&str, &str)] = &[
    ("openai", "OpenAI"),
    ("deepseek", "DeepSeek"),
    ("xai", "xAI"),
    ("z.ai", "Z.ai"),
];

/// The bold line: provider, then model — `OpenAI - GPT 5.6 Sol`. The provider leads because
/// one proxy fronts several vendors, and the id alone doesn't say whose account a pick spends.
pub(crate) fn display_label(id: &str, owned_by: Option<&str>) -> String {
    match provider_name(owned_by) {
        Some(provider) => format!("{provider} - {}", model_name(id)),
        None => model_name(id),
    }
}

/// The caption, in the native catalog's shape (`Sonnet 5 · Efficient for routine tasks`):
/// the model, then the two things the id and the owner say for certain — the cut of the model
/// the vendor named it after, and which account answers for it.
pub(crate) fn display_description(id: &str, owned_by: Option<&str>) -> String {
    let tail = match provider_name(owned_by) {
        Some(provider) => format!("on your {provider} account"),
        None => "through your local CLIProxyAPI".to_string(),
    };
    let head = match tier(id) {
        Tier::Thinking => "Extended reasoning,",
        Tier::Plain => "Runs",
        Tier::Code => "Tuned for coding,",
        Tier::Fast => "Faster and lighter,",
    };
    format!("{} · {head} {tail}", model_name(id))
}

/// `gpt-5.6-sol` → `GPT 5.6 Sol`, `kimi-k3` → `Kimi K3`. Every hyphen becomes a space and
/// each segment title-cases, so the result reads like the native catalog's `Opus 4.8`.
fn model_name(id: &str) -> String {
    let mut name = String::with_capacity(id.len());
    for segment in id.split('-').filter(|s| !s.is_empty()) {
        if !name.is_empty() {
            name.push(' ');
        }
        push_segment(&mut name, segment);
    }
    // An id of nothing but separators has no friendlier form than itself.
    if name.is_empty() {
        return id.to_string();
    }
    name
}

fn push_segment(name: &mut String, segment: &str) {
    if ACRONYMS.contains(&segment.to_ascii_lowercase().as_str()) {
        name.push_str(&segment.to_ascii_uppercase());
        return;
    }
    let mut chars = segment.chars();
    if let Some(first) = chars.next() {
        name.extend(first.to_uppercase());
        name.push_str(chars.as_str());
    }
}

fn provider_name(owned_by: Option<&str>) -> Option<String> {
    let owner = owned_by.map(str::trim).filter(|o| !o.is_empty())?;
    let lower = owner.to_ascii_lowercase();
    match PROVIDER_NAMES.iter().find(|(key, _)| *key == lower) {
        Some((_, name)) => Some((*name).to_string()),
        None => Some(model_name(owner)),
    }
}

#[cfg(test)]
#[path = "label_tests.rs"]
mod tests;
