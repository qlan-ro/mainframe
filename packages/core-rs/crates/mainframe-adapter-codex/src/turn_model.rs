//! Todo #303 — resolves the model id a Codex turn-start must carry.
//!
//! `collaborationMode.settings.model` is required and non-nullable in the
//! app-server protocol (`Settings.ts`, codex-cli 0.144.3), so `send_message`
//! must always have a concrete id before it builds a turn config. This picks
//! one from three tiers, in priority order: the chat's configured model, the
//! model the app-server itself reported on `thread/start`/`thread/resume`,
//! and the provider/catalog default computed once at spawn.

use mainframe_adapter_api::AdapterError;

/// Empty and whitespace-only strings are treated as absent at every tier. Also used
/// by `session.rs` when it captures the app-server's reported model off the wire, so
/// a blank report is stored as `None` rather than `Some("")`.
pub(crate) fn non_empty(v: Option<&str>) -> Option<&str> {
    v.map(str::trim).filter(|s| !s.is_empty())
}

/// Resolves the model id for a turn-start, trying `configured`, then
/// `reported`, then `default_hint` in order. Returns an error naming the
/// missing model when none of the three tiers yields one — the caller must
/// not start a turn without a model, since silently omitting the
/// collaboration mode would also drop plan mode.
pub(crate) fn resolve_turn_model(
    configured: Option<&str>,
    reported: Option<&str>,
    default_hint: Option<&str>,
) -> Result<String, AdapterError> {
    non_empty(configured)
        .or_else(|| non_empty(reported))
        .or_else(|| non_empty(default_hint))
        .map(str::to_string)
        .ok_or_else(|| {
            AdapterError::Message(
                "Codex could not determine which model to use: this chat has no model \
                 selected, the Codex app-server reported none, and no default model is \
                 configured. Pick a model in the composer or set a Codex default in Settings."
                    .to_string(),
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configured_wins_over_reported_and_hint() {
        assert_eq!(
            resolve_turn_model(Some("gpt-5.5"), Some("gpt-5.6-sol"), Some("gpt-4")).unwrap(),
            "gpt-5.5"
        );
    }

    #[test]
    fn empty_configured_falls_through_to_reported() {
        assert_eq!(
            resolve_turn_model(Some(""), Some("gpt-5.6-sol"), Some("gpt-4")).unwrap(),
            "gpt-5.6-sol"
        );
    }

    #[test]
    fn absent_reported_falls_through_to_the_hint() {
        assert_eq!(
            resolve_turn_model(None, None, Some("gpt-4")).unwrap(),
            "gpt-4"
        );
    }

    #[test]
    fn all_absent_returns_an_error_naming_the_missing_model() {
        let err = resolve_turn_model(None, None, None).unwrap_err();
        assert!(err.to_string().to_lowercase().contains("model"));
    }

    #[test]
    fn whitespace_only_values_are_treated_as_absent_at_each_tier() {
        assert_eq!(
            resolve_turn_model(Some("  "), Some(" \t"), Some("gpt-4")).unwrap(),
            "gpt-4"
        );
    }
}

// PORT STATUS: new file, no TS equivalent (todo #303)
// confidence: high
// todos: 0
// notes: the TS builder relied on JS falsiness (`modelId ? ... : {}`) to omit the
// notes: model key entirely; the app-server protocol makes that omission invalid, so
// notes: this resolver replaces "omit when absent" with "always resolve, error when
// notes: unresolvable" and has no prior Node source to port.
