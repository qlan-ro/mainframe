//! What counts as a usable generated title. Shared by every adapter that
//! overrides `Adapter::generate_title`, so the accepted shape can't drift
//! between the CLIs.

/// The title in a title model's `stdout`: trimmed, with one leading and one
/// trailing quote removed. Returns `None`, so the caller keeps the
/// deterministic title, unless the result is 2 to 80 characters long.
pub fn finalize_title(stdout: &str) -> Option<String> {
    let mut t = stdout.trim().to_string();
    if t.starts_with('"') || t.starts_with('\'') {
        t.remove(0);
    }
    if t.ends_with('"') || t.ends_with('\'') {
        t.pop();
    }
    let title = t.trim();
    (2..=80)
        .contains(&title.chars().count())
        .then(|| title.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_surrounding_quotes_and_trims() {
        assert_eq!(
            finalize_title("  \"Auth Refactor\"\n"),
            Some("Auth Refactor".to_string())
        );
        assert_eq!(
            finalize_title("'Fix Login Bug'"),
            Some("Fix Login Bug".to_string())
        );
    }

    #[test]
    fn rejects_too_short_or_too_long() {
        assert_eq!(finalize_title("a"), None);
        assert_eq!(finalize_title("   "), None);
        let long: String = "x".repeat(81);
        assert_eq!(finalize_title(&long), None);
    }
}
