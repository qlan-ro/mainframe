//! Codex model context windows (todo #352). `model/list` carries no window,
//! so this is a snapshot of codex-cli 0.153.4's packaged `modelCatalogJson`,
//! consulted only when the wire's own `tokenUsage.modelContextWindow` is
//! absent.

/// Falls back for a model id the table doesn't recognize — codex-cli's own
/// packaged default for its common models.
pub(crate) const DEFAULT_CODEX_CONTEXT_WINDOW: i64 = 272_000;

const KNOWN_WINDOWS: &[(&str, i64)] = &[
    ("gpt-6-astra", 272_000),
    ("gpt-5.6-sol", 272_000),
    ("gpt-5.6-terra", 272_000),
    ("gpt-5.6-luna", 272_000),
    ("gpt-daybreak-blue-latest", 272_000),
    ("gpt-5.5", 272_000),
    ("gpt-5.4", 272_000),
    ("gpt-5.4-mini", 272_000),
    ("gpt-5.2", 272_000),
    ("codex-auto-review", 272_000),
    ("gpt-daybreak-red-latest", 372_000),
];

/// The table's window for a known model id, with no default — callers that
/// must not guess (the emission path, AC 4) use this.
pub(crate) fn known_context_window(id: Option<&str>) -> Option<i64> {
    let id = id?;
    KNOWN_WINDOWS
        .iter()
        .find(|(known_id, _)| *known_id == id)
        .map(|(_, window)| *window)
}

/// The table's window for a known id, or the packaged default — the catalog
/// path (`AdapterModel.contextWindow`), which always needs a divisor.
pub(crate) fn catalog_context_window(id: &str) -> i64 {
    known_context_window(Some(id)).unwrap_or(DEFAULT_CODEX_CONTEXT_WINDOW)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_context_window_returns_the_table_value_for_a_known_id() {
        assert_eq!(known_context_window(Some("gpt-5.5")), Some(272_000));
    }

    #[test]
    fn known_context_window_returns_the_outlier_for_gpt_daybreak_red() {
        assert_eq!(
            known_context_window(Some("gpt-daybreak-red-latest")),
            Some(372_000)
        );
    }

    #[test]
    fn known_context_window_is_none_for_an_unrecognized_id() {
        assert_eq!(known_context_window(Some("some-future-model")), None);
        assert_eq!(known_context_window(None), None);
    }

    #[test]
    fn catalog_context_window_returns_the_table_value_for_a_known_id() {
        assert_eq!(catalog_context_window("gpt-5.4"), 272_000);
    }

    #[test]
    fn catalog_context_window_falls_back_to_the_default_for_an_unknown_id() {
        assert_eq!(
            catalog_context_window("some-future-model"),
            DEFAULT_CODEX_CONTEXT_WINDOW
        );
    }
}
