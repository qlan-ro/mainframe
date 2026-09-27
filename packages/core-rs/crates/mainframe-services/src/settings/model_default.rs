pub fn normalize_saved_default_model(configured_model: Option<&str>) -> Option<String> {
    configured_model
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_explicit_selection_and_normalizes_unset_values() {
        for (configured, expected) in [
            (Some("custom-opus"), Some("custom-opus")),
            (Some(" opus "), Some("opus")),
            (Some("default"), Some("default")),
            (Some("  "), None),
            (Some(""), None),
            (None, None),
        ] {
            assert_eq!(
                normalize_saved_default_model(configured).as_deref(),
                expected
            );
        }
    }
}
