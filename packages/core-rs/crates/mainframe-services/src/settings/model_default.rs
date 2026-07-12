//! Ported from `src/settings/model-default.ts`.

use mainframe_types::adapter::AdapterModel;

/// Drop a saved default-model id that is no longer offered by the live catalog.
///
/// Returns the configured id unchanged when there is nothing to normalize (no id
/// saved), when the catalog is empty (a probe failure can't judge validity), or
/// when the id is present; returns `None` only when a non-empty catalog does not
/// contain the id.
pub fn normalize_saved_default_model(
    configured_model: Option<&str>,
    models: &[AdapterModel],
) -> Option<String> {
    let configured = configured_model?;
    if models.is_empty() {
        return Some(configured.to_string());
    }
    models
        .iter()
        .any(|model| model.id == configured)
        .then(|| configured.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(id: &str, label: &str, is_default: Option<bool>) -> AdapterModel {
        AdapterModel {
            id: id.to_string(),
            label: label.to_string(),
            description: None,
            resolved_model: None,
            context_window: None,
            is_default,
            supported_efforts: None,
            default_effort: None,
            supports_fast: None,
            supports_ultracode: None,
            supports_adaptive_thinking: None,
            supports_personality: None,
        }
    }

    #[test]
    fn preserves_a_configured_model_present_in_the_catalog() {
        assert_eq!(
            normalize_saved_default_model(Some("sonnet"), &[model("sonnet", "Sonnet 5", None)]),
            Some("sonnet".to_string())
        );
    }

    #[test]
    fn preserves_a_configured_model_while_the_catalog_is_empty() {
        assert_eq!(
            normalize_saved_default_model(Some("opus"), &[]),
            Some("opus".to_string())
        );
    }

    #[test]
    fn omits_a_configured_model_absent_from_a_non_empty_catalog() {
        assert_eq!(
            normalize_saved_default_model(
                Some("opus"),
                &[
                    model("default", "Default - Opus 4.8", Some(true)),
                    model("sonnet", "Sonnet 5", None),
                ],
            ),
            None
        );
    }

    #[test]
    fn passes_through_an_unset_configured_model() {
        assert_eq!(
            normalize_saved_default_model(None, &[model("sonnet", "Sonnet 5", None)]),
            None
        );
    }
}

// PORT STATUS: src/settings/model-default.ts (9 lines)
// confidence: high
// todos: 0
// notes: 1:1 port of normalizeSavedDefaultModel. `Option<&str> -> Option<String>`
// mirrors `string | undefined -> string | undefined`: an unset id and an id
// dropped as invalid both collapse to `None`, matching the two `undefined`
// returns. Empty catalog short-circuits to the configured id (a probe failure
// must not wipe the saved default). Tests port model-default.test.ts assertion
// for assertion, plus the `None`-input edge the Option mapping introduces.
