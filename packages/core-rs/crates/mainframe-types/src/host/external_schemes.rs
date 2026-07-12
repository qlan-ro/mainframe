//! Ported from `packages/types/src/host/external-schemes.ts`.
//!
//! The single canonical allowlist of URL schemes safe to forward to the OS opener.
//! THIS constant is the source of truth. All hosts (Electron main process, Tauri
//! Rust shell) must derive or mirror this set so both behave 1:1.

pub const ALLOWED_EXTERNAL_SCHEMES: [&str; 15] = [
    "http",
    "https",
    "mailto",
    "slack",
    "vscode",
    "vscode-insiders",
    "cursor",
    "jetbrains",
    "idea",
    "zed",
    "figma",
    "linear",
    "notion",
    "discord",
    "tel",
];

/// True only if `url`'s scheme is in [`ALLOWED_EXTERNAL_SCHEMES`] (case-insensitive).
pub fn is_allowed_external_scheme(url: &str) -> bool {
    let lower = url.to_lowercase();
    ALLOWED_EXTERNAL_SCHEMES
        .iter()
        .any(|s| lower.starts_with(&format!("{s}://")) || lower.starts_with(&format!("{s}:")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_http_https_case_insensitively() {
        assert!(is_allowed_external_scheme("https://example.com"));
        assert!(is_allowed_external_scheme("HTTP://localhost:3000"));
    }

    #[test]
    fn allows_ide_and_app_schemes() {
        for s in [
            "vscode",
            "cursor",
            "jetbrains",
            "zed",
            "slack",
            "linear",
            "notion",
            "figma",
            "discord",
            "tel",
            "mailto",
        ] {
            assert!(is_allowed_external_scheme(&format!("{s}://open/x")));
        }
    }

    #[test]
    fn allows_no_slash_forms_and_ide_variants() {
        assert!(is_allowed_external_scheme("mailto:user@example.com"));
        assert!(is_allowed_external_scheme("tel:+15551234567"));
        assert!(is_allowed_external_scheme("idea://open?file=x"));
        assert!(is_allowed_external_scheme("vscode-insiders://open"));
    }

    #[test]
    fn rejects_dangerous_schemes() {
        for u in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "ssh://host",
            "data:text/html,x",
            "ftp://x",
            "",
        ] {
            assert!(!is_allowed_external_scheme(u));
        }
    }

    #[test]
    fn exposes_canonical_list_without_trailing_colons() {
        assert!(ALLOWED_EXTERNAL_SCHEMES.contains(&"vscode-insiders"));
        assert!(ALLOWED_EXTERNAL_SCHEMES.iter().all(|s| !s.ends_with(':')));
    }
}

// PORT STATUS: packages/types/src/host/external-schemes.ts (30 lines)
// confidence: high
// todos: 0
// notes: pure const + predicate; ported assertion-for-assertion. `ssh://host` and
// `data:text/html,x` correctly reject because those schemes are not in the list
// (matches the TS: prefix check only fires for allowlisted schemes).
