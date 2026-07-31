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
pub fn display_label(id: &str, owned_by: Option<&str>) -> String {
    match provider_name(owned_by) {
        Some(provider) => format!("{provider} - {}", model_name(id)),
        None => model_name(id),
    }
}

/// The caption, in the native catalog's shape (`Sonnet 5 · Efficient for routine tasks`):
/// the model, then the two things the id and the owner say for certain — the cut of the model
/// the vendor named it after, and which account answers for it.
pub fn display_description(id: &str, owned_by: Option<&str>) -> String {
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
mod tests {
    use super::*;

    /// The catalog a real install serves, so the expectations are the strings that actually
    /// reach the picker rather than invented ids.
    #[test]
    fn a_label_names_the_provider_then_the_model() {
        for (id, owner, expected) in [
            ("kimi-k3", "moonshot", "Moonshot - Kimi K3"),
            ("gpt-5.6-sol", "openai", "OpenAI - GPT 5.6 Sol"),
            ("gpt-5.4-mini", "openai", "OpenAI - GPT 5.4 Mini"),
            (
                "gpt-5.3-codex-spark",
                "openai",
                "OpenAI - GPT 5.3 Codex Spark",
            ),
            (
                "kimi-k2.7-code-highspeed",
                "moonshot",
                "Moonshot - Kimi K2.7 Code Highspeed",
            ),
            ("codex-auto-review", "openai", "OpenAI - Codex Auto Review"),
        ] {
            assert_eq!(display_label(id, Some(owner)), expected, "{id}");
        }
    }

    /// Vendors spell their own names; a title-case pass would print `Openai`.
    #[test]
    fn a_known_provider_keeps_its_own_spelling() {
        assert_eq!(display_label("gpt-5.5", Some("OPENAI")), "OpenAI - GPT 5.5");
        assert_eq!(display_label("glm-4.6", Some("z.ai")), "Z.ai - GLM 4.6");
        assert_eq!(display_label("grok-5", Some("xai")), "xAI - Grok 5");
        // An owner we've never seen still reads as a name.
        assert_eq!(
            display_label("mistral-3", Some("mistral")),
            "Mistral - Mistral 3"
        );
    }

    /// The proxy may report no owner, or a blank one; neither leaves a dangling separator.
    #[test]
    fn a_missing_provider_leaves_the_model_standing_alone() {
        assert_eq!(display_label("kimi-k3", None), "Kimi K3");
        assert_eq!(display_label("kimi-k3", Some("   ")), "Kimi K3");
    }

    /// A degenerate id must fall back to itself, never to an empty picker row.
    #[test]
    fn an_id_with_nothing_to_format_falls_back_to_itself() {
        assert_eq!(display_label("", None), "");
        assert_eq!(display_label("---", None), "---");
        assert_eq!(display_label("-kimi-", None), "Kimi");
    }

    #[test]
    fn a_description_names_the_variant_and_the_account_that_pays() {
        for (id, owner, expected) in [
            (
                "gpt-5.6-sol",
                "openai",
                "GPT 5.6 Sol · Runs on your OpenAI account",
            ),
            (
                "gpt-5.4-mini",
                "openai",
                "GPT 5.4 Mini · Faster and lighter, on your OpenAI account",
            ),
            (
                "kimi-k2.7-code",
                "moonshot",
                "Kimi K2.7 Code · Tuned for coding, on your Moonshot account",
            ),
            (
                "kimi-k2-thinking",
                "moonshot",
                "Kimi K2 Thinking · Extended reasoning, on your Moonshot account",
            ),
        ] {
            assert_eq!(display_description(id, Some(owner)), expected, "{id}");
        }
    }

    /// With no owner the caption still has to say where the model came from.
    #[test]
    fn a_description_without_an_owner_names_the_proxy_instead() {
        assert_eq!(
            display_description("kimi-k3", None),
            "Kimi K3 · Runs through your local CLIProxyAPI"
        );
        assert_eq!(
            display_description("kimi-k2.7-code-highspeed", None),
            "Kimi K2.7 Code Highspeed · Faster and lighter, through your local CLIProxyAPI"
        );
    }
}
