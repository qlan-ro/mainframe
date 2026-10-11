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
pub(crate) fn is_allowed_origin(origin: Option<&str>) -> bool {
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
#[path = "cors_origin_tests.rs"]
mod tests;
