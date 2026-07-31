//! `preview-bridge` — the only IPC surface exposed to preview child webviews.
//!
//! Child previews load remote origins (the user's dev server / tunnel), and
//! Tauri denies every IPC command from a remote origin unless a capability
//! with an explicit `remote` context grants it (`capabilities/preview.json`,
//! scoped to `preview-*` webview labels). These callbacks live in an inlined
//! plugin (declared in `build.rs`) because plugin commands get build-time ACL
//! permissions we can grant narrowly — exposing bare app commands to remote
//! origins would require an app-wide ACL manifest gating every command.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Emitter, Runtime};

use super::{is_allowed_external_scheme, InspectResult, NavigateResult, RegionSelectResult};

/// Open a URL in the OS default browser.
///
/// Only allowlisted schemes are forwarded to the opener. Any other scheme
/// (`file://`, `javascript:`, `ssh://`, etc.) is rejected and logged to
/// prevent BRIDGE_JS from being used as an OS-command injection vector
/// (Finding 2).
#[tauri::command]
async fn open_external<R: Runtime>(url: String, app: tauri::AppHandle<R>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if !is_allowed_external_scheme(&url) {
        tracing::warn!(url = %url, "preview open_external: rejected disallowed scheme");
        return Err(format!("disallowed URL scheme: {url}"));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Receive the inspect-picker result from the injected BRIDGE_JS and re-emit
/// it as a Tauri event that `PreviewInstance` can listen to.
#[tauri::command]
async fn inspect_result<R: Runtime>(
    result: InspectResult,
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    app.emit("preview:inspect-result", &result)
        .map_err(|e| e.to_string())
}

/// Receive the region-select result from the injected BRIDGE_JS and re-emit it
/// as a Tauri event that `PreviewInstance` can listen to.
#[tauri::command]
async fn region_result<R: Runtime>(
    result: RegionSelectResult,
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    app.emit("preview:region-select", &result)
        .map_err(|e| e.to_string())
}

/// Receive a navigation event from the injected BRIDGE_JS tracker and re-emit it
/// as a Tauri event that `PreviewInstance`'s `onNavigate` subscription listens to.
#[tauri::command]
async fn navigate_event<R: Runtime>(
    result: NavigateResult,
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    app.emit("preview:navigate", &result)
        .map_err(|e| e.to_string())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("preview-bridge")
        .invoke_handler(tauri::generate_handler![
            open_external,
            inspect_result,
            region_result,
            navigate_event
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use super::super::bridge::BRIDGE_JS;
    use super::is_allowed_external_scheme;

    /// BRIDGE_JS runs in remote-origin child webviews, where Tauri's ACL only
    /// allows the plugin-prefixed commands granted by capabilities/preview.json.
    /// A bare app-command invoke would be silently denied — the exact bug this
    /// plugin exists to fix.
    #[test]
    fn bridge_js_invokes_only_plugin_prefixed_commands() {
        for cmd in [
            "plugin:preview-bridge|open_external",
            "plugin:preview-bridge|inspect_result",
            "plugin:preview-bridge|region_result",
            "plugin:preview-bridge|navigate_event",
        ] {
            assert!(
                BRIDGE_JS.contains(&format!("invoke('{cmd}'")),
                "missing {cmd}"
            );
        }
        for legacy in [
            "'preview_open_external'",
            "'preview_inspect_result'",
            "'preview_region_result'",
            "'preview_navigate_event'",
        ] {
            assert!(
                !BRIDGE_JS.contains(legacy),
                "legacy app-command invoke left in BRIDGE_JS: {legacy}"
            );
        }
    }

    /// The remote capability must keep granting exactly the four bridge
    /// callbacks to preview-* webviews, or child→app IPC dies again.
    #[test]
    fn preview_capability_grants_bridge_commands_to_preview_webviews() {
        let cap: serde_json::Value =
            serde_json::from_str(include_str!("../../capabilities/preview.json"))
                .expect("capabilities/preview.json must parse");
        assert_eq!(cap["webviews"][0], "preview-*");
        let urls: Vec<&str> = cap["remote"]["urls"]
            .as_array()
            .expect("remote.urls")
            .iter()
            .filter_map(|u| u.as_str())
            .collect();
        assert_eq!(urls.len(), 2, "remote.urls must carry exactly two patterns");
        assert!(
            urls.contains(&"http://*:*"),
            "http://*:* missing from remote urls"
        );
        assert!(
            urls.contains(&"https://*:*"),
            "https://*:* missing from remote urls"
        );
        let perms: Vec<&str> = cap["permissions"]
            .as_array()
            .expect("permissions")
            .iter()
            .filter_map(|p| p.as_str())
            .collect();
        for p in [
            "preview-bridge:allow-inspect-result",
            "preview-bridge:allow-region-result",
            "preview-bridge:allow-navigate-event",
            "preview-bridge:allow-open-external",
        ] {
            assert!(perms.contains(&p), "missing permission {p}");
        }
    }

    /// The widened patterns must actually span every http(s) host, port, and
    /// path — not just the default port a bare `http://*` would silently
    /// restrict to (spec D1).
    #[test]
    fn preview_capability_patterns_match_every_http_origin() {
        use tauri::utils::acl::RemoteUrlPattern;
        use tauri::Url;

        let patterns: Vec<RemoteUrlPattern> = ["http://*:*", "https://*:*"]
            .iter()
            .map(|p| p.parse().expect("pattern must parse"))
            .collect();
        let matches = |raw: &str| {
            let url = Url::parse(raw).expect("test URL must parse");
            patterns.iter().any(|p| p.test(&url))
        };

        for allowed in [
            "http://localhost:5173/path",
            "http://192.168.1.5:3000/a?b=1",
            "https://example.com:8443/a",
            "https://example.com/x",
        ] {
            assert!(matches(allowed), "expected a pattern to match {allowed}");
        }
        for disallowed in ["file:///etc/passwd", "ssh://host"] {
            assert!(
                !matches(disallowed),
                "no pattern should match {disallowed}"
            );
        }
    }

    /// The widened remote allowlist must not be mistaken for a widened
    /// opener: `open_external` keeps rejecting non-http(s) schemes.
    #[test]
    fn external_open_scheme_guard_still_rejects_dangerous_schemes() {
        for dangerous in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "ssh://host",
            "vscode://open",
            "slack://chan",
            "jetbrains://x",
        ] {
            assert!(
                !is_allowed_external_scheme(dangerous),
                "expected rejected: {dangerous}"
            );
        }
        for safe in ["http://x", "https://x"] {
            assert!(is_allowed_external_scheme(safe), "expected allowed: {safe}");
        }
    }
}
