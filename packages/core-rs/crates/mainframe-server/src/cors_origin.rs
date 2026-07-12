//! Ported from `src/server/cors-origin.ts`.
//!
//! Origins permitted to make cross-origin requests to the daemon.
//!
//! The daemon only ever serves localhost clients, but a desktop webview does not
//! always present an `http(s)://localhost` origin:
//!   - dev vite / Electron dev → `http://localhost:<port>` / `http://127.0.0.1:<port>`
//!   - packaged Tauri (macOS/Linux) → `tauri://localhost` custom scheme
//!   - packaged Tauri (Windows) → `http://tauri.localhost`
//!
//! A too-narrow allowlist silently omits the `Access-Control-Allow-Origin`
//! header, so WKWebView blocks every daemon response and the packaged app hangs
//! on "waiting for daemon" even though the daemon is healthy (curl, which sends
//! no Origin, is unaffected — masking the bug).

/// `^(https?://(localhost|127\.0\.0\.1)(:\d+)?|tauri://localhost|https?://tauri\.localhost)$`
/// — the `ALLOWED_ORIGIN` regex, hand-matched (no `regex` crate in the allowlist).
pub fn is_allowed_origin(origin: Option<&str>) -> bool {
    match origin {
        Some(origin) => matches_allowed(origin),
        None => false,
    }
}

fn matches_allowed(origin: &str) -> bool {
    // `tauri://localhost` — packaged Tauri (macOS/Linux) custom scheme, no port.
    if origin == "tauri://localhost" {
        return true;
    }
    // `http(s)://tauri.localhost` — packaged Tauri (Windows), no port.
    if origin == "http://tauri.localhost" || origin == "https://tauri.localhost" {
        return true;
    }
    // `http(s)://(localhost|127.0.0.1)(:\d+)?`
    let Some(rest) = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
    else {
        return false;
    };
    let (host, port) = match rest.split_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (rest, None),
    };
    if host != "localhost" && host != "127.0.0.1" {
        return false;
    }
    match port {
        None => true,
        Some(port) => !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()),
    }
}

#[cfg(test)]
mod tests {
    use super::is_allowed_origin;

    #[test]
    fn allows_http_localhost_with_a_dev_vite_port() {
        assert!(is_allowed_origin(Some("http://localhost:5174")));
    }

    #[test]
    fn allows_http_localhost_with_the_daemon_port() {
        assert!(is_allowed_origin(Some("http://localhost:31500")));
    }

    #[test]
    fn allows_http_127_with_a_port() {
        assert!(is_allowed_origin(Some("http://127.0.0.1:31500")));
    }

    #[test]
    fn allows_https_localhost_with_a_port() {
        assert!(is_allowed_origin(Some("https://localhost:5174")));
    }

    #[test]
    fn allows_http_localhost_with_no_port() {
        assert!(is_allowed_origin(Some("http://localhost")));
    }

    #[test]
    fn allows_the_packaged_tauri_macos_linux_custom_scheme_origin() {
        assert!(is_allowed_origin(Some("tauri://localhost")));
    }

    #[test]
    fn allows_the_packaged_tauri_windows_http_origin() {
        assert!(is_allowed_origin(Some("http://tauri.localhost")));
    }

    #[test]
    fn allows_the_packaged_tauri_windows_https_origin() {
        assert!(is_allowed_origin(Some("https://tauri.localhost")));
    }

    #[test]
    fn rejects_an_undefined_origin() {
        assert!(!is_allowed_origin(None));
    }

    #[test]
    fn rejects_an_empty_string_origin() {
        assert!(!is_allowed_origin(Some("")));
    }

    #[test]
    fn rejects_an_unrelated_external_origin() {
        assert!(!is_allowed_origin(Some("http://evil.com")));
    }

    #[test]
    fn rejects_an_https_external_origin() {
        assert!(!is_allowed_origin(Some("https://example.com")));
    }

    #[test]
    fn rejects_a_domain_that_merely_starts_with_localhost() {
        assert!(!is_allowed_origin(Some("http://localhost.evil.com")));
    }

    #[test]
    fn rejects_a_domain_that_merely_starts_with_127() {
        assert!(!is_allowed_origin(Some("http://127.0.0.1.evil.com")));
    }

    #[test]
    fn rejects_a_tauri_scheme_with_a_non_localhost_host() {
        assert!(!is_allowed_origin(Some("tauri://evil")));
    }

    #[test]
    fn rejects_the_literal_null_origin_sent_by_file_contexts() {
        assert!(!is_allowed_origin(Some("null")));
    }
}

// PORT STATUS: src/server/cors-origin.ts (isAllowedOrigin)
// confidence: high
// todos: 0
// notes: Main catch-up (#411): the allowlist widens from localhost/127.0.0.1 to
// also accept the packaged-Tauri origins (`tauri://localhost`,
// `http(s)://tauri.localhost`). Regex hand-matched (no `regex` crate in the
// allowlist); all 16 cors-origin.test.ts cases translated 1:1.
