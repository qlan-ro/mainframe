use mainframe_adapter_api::AdapterError;

pub(crate) fn non_empty(v: Option<&str>) -> Option<&str> {
    v.map(str::trim).filter(|s| !s.is_empty())
}

pub(crate) fn resolve_turn_model(
    configured: Option<&str>,
    reported: Option<&str>,
) -> Result<String, AdapterError> {
    non_empty(configured)
        .or_else(|| non_empty(reported))
        .map(str::to_owned)
        .ok_or_else(|| {
            AdapterError::Message(
                "Codex did not report a model. Select a model in the composer or check the Codex configuration."
                    .into(),
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configured_selection_wins_over_reported_model() {
        assert_eq!(
            resolve_turn_model(Some("gpt-5.5"), Some("gpt-5.6-sol")).unwrap(),
            "gpt-5.5"
        );
    }

    #[test]
    fn empty_selection_uses_the_cli_report() {
        assert_eq!(
            resolve_turn_model(Some(""), Some("gpt-5.6-sol")).unwrap(),
            "gpt-5.6-sol"
        );
    }

    #[test]
    fn missing_model_is_an_error() {
        assert!(resolve_turn_model(None, None).is_err());
        assert!(resolve_turn_model(Some("  "), Some(" \t")).is_err());
    }
}
