pub mod bridge;
pub mod bridge_plugin;
pub mod crop;

#[cfg(target_os = "macos")]
mod capture_macos;
#[cfg(not(target_os = "macos"))]
mod capture_stub;

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{State, WebviewUrl};

pub use crop::Region;

// ── Types ──────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, serde::Deserialize, serde::Serialize)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Viewport dimensions sent by the BRIDGE_JS inspect handler.
///
/// The bridge sends `{ w, h }` only (no x/y).  A dedicated struct avoids
/// requiring x/y fields on deserialization and is clearer than `#[serde(default)]`
/// on `Bounds` (Finding 3b).
#[derive(Clone, Copy, Debug, serde::Deserialize, serde::Serialize)]
pub struct Viewport {
    pub w: f64,
    pub h: f64,
}

/// Result posted back by the BRIDGE_JS element-inspect picker.
///
/// `#[serde(rename_all = "camelCase")]` maps `tab_id` ↔ `tabId` so that the
/// bridge's camelCase JSON binds correctly (Finding 3a).
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InspectResult {
    pub tab_id: String,
    pub selector: Option<String>,
    pub rect: Option<Bounds>,
    pub viewport: Option<Viewport>,
}

/// Result posted back by the BRIDGE_JS region-select picker.
/// camelCase maps `tab_id` ↔ `tabId`; `region` is null on cancel.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RegionSelectResult {
    pub tab_id: String,
    pub region: Option<Region>,
}

/// Result posted back by the BRIDGE_JS navigation tracker.
/// camelCase maps `tab_id` ↔ `tabId`.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NavigateResult {
    pub tab_id: String,
    pub url: String,
}

// ── URL scheme allowlist ───────────────────────────────────────────────────────

/// Canonical allowlist — mirrors @qlan-ro/mainframe-types ALLOWED_EXTERNAL_SCHEMES
/// (source of truth: packages/types/src/host/external-schemes.ts). Both hosts behave 1:1.
const ALLOWED_EXTERNAL_SCHEMES: &[&str] = &[
    "http", "https", "mailto", "slack", "vscode", "vscode-insiders", "cursor",
    "jetbrains", "idea", "zed", "figma", "linear", "notion", "discord", "tel",
];

/// Returns `true` only for schemes safe to forward to the OS opener.
/// Rejects `file://`, `javascript:`, `ssh://`, `data:` and any unknown scheme.
pub(crate) fn is_allowed_external_scheme(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    ALLOWED_EXTERNAL_SCHEMES
        .iter()
        .any(|s| lower.starts_with(&format!("{s}://")) || lower.starts_with(&format!("{s}:")))
}

// ── PreviewManager ─────────────────────────────────────────────────────────────

/// Entry stored for each live preview tab.
struct PreviewEntry {
    #[allow(dead_code)] // retained for future set_bounds update
    bounds: Bounds,
    /// The live child webview handle; populated by `preview_create`.
    webview: Option<tauri::Webview>,
}

/// Manages all live preview child webviews.
/// Registered as Tauri managed state (`app.manage(PreviewManager::new())`).
pub struct PreviewManager {
    tabs: Mutex<HashMap<String, PreviewEntry>>,
}

impl PreviewManager {
    pub fn new() -> Self {
        Self { tabs: Mutex::new(HashMap::new()) }
    }

    /// Poison-safe lock — mirrors terminal/mod.rs:71-73.
    fn lock_tabs(&self) -> std::sync::MutexGuard<'_, HashMap<String, PreviewEntry>> {
        self.tabs.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Register a tab id with bounds only (no webview yet).
    /// Returns `false` if already present (idempotent).
    /// Used by bookkeeping tests; `preview_create` uses `insert_webview` directly.
    #[allow(dead_code)]
    pub fn register(&self, tab_id: &str, bounds: Bounds) -> bool {
        let mut tabs = self.lock_tabs();
        if tabs.contains_key(tab_id) {
            return false;
        }
        tabs.insert(tab_id.to_string(), PreviewEntry { bounds, webview: None });
        true
    }

    pub fn has(&self, tab_id: &str) -> bool {
        self.lock_tabs().contains_key(tab_id)
    }

    /// Store the live webview handle after `add_child` succeeds.
    pub fn insert_webview(&self, tab_id: &str, bounds: Bounds, webview: tauri::Webview) {
        let mut tabs = self.lock_tabs();
        tabs.insert(tab_id.to_string(), PreviewEntry { bounds, webview: Some(webview) });
    }

    /// Run a closure against the live webview for `tab_id`.
    /// Returns `None` if the tab doesn't exist; the closure result otherwise.
    pub fn with_webview<F, T>(&self, tab_id: &str, f: F) -> Option<T>
    where
        F: FnOnce(&tauri::Webview) -> T,
    {
        let tabs = self.lock_tabs();
        tabs.get(tab_id)?.webview.as_ref().map(f)
    }

    /// Remove the tab and return the webview handle (for close-before-remove).
    pub fn take_webview(&self, tab_id: &str) -> Option<tauri::Webview> {
        self.lock_tabs().remove(tab_id)?.webview
    }

    /// Remove a tab without a live webview (bookkeeping-only path).
    /// Returns `false` if not present.
    #[allow(dead_code)]
    pub fn unregister(&self, tab_id: &str) -> bool {
        self.lock_tabs().remove(tab_id).is_some()
    }

    #[allow(dead_code)]
    pub fn count(&self) -> usize {
        self.lock_tabs().len()
    }

    /// Close every child webview — called on `WindowEvent::Destroyed`.
    pub fn kill_all(&self) {
        let mut tabs = self.lock_tabs();
        for (_, entry) in tabs.iter() {
            if let Some(wv) = &entry.webview {
                let _ = wv.close();
            }
        }
        tabs.clear();
    }
}

impl Default for PreviewManager {
    fn default() -> Self {
        Self::new()
    }
}

// ── Commands ───────────────────────────────────────────────────────────────────

/// Create (or idempotently re-navigate) a child webview for the given tab.
///
/// Requires `tauri` compiled with the `unstable` feature (added to Cargo.toml).
/// `window.add_child` is only available under that feature.
#[tauri::command]
pub async fn preview_create(
    tab_id: String,
    url: String,
    bounds: Bounds,
    window: tauri::Window,
    manager: State<'_, PreviewManager>,
) -> Result<(), String> {
    // Idempotent: already registered → just navigate.
    if manager.has(&tab_id) {
        return preview_navigate(tab_id, url, manager).await;
    }

    let parsed: tauri::Url = url.parse().map_err(|e| format!("bad url: {e}"))?;
    // Bake this tab's id into the page so BRIDGE_JS can stamp navigation/inspect
    // events with it on first load (before any picker install sets it).
    let tab_id_json = serde_json::to_string(&tab_id).unwrap_or_else(|_| "\"\"".to_string());
    let init_script = format!(
        "window.__mfPreviewTabId={tab_id_json};\n{}",
        crate::preview::bridge::BRIDGE_JS
    );
    let builder = tauri::webview::WebviewBuilder::new(&tab_id, WebviewUrl::External(parsed))
        .initialization_script(&init_script);

    let pos = tauri::LogicalPosition::new(bounds.x, bounds.y);
    let size = tauri::LogicalSize::new(bounds.w, bounds.h);

    let webview = window
        .add_child(builder, pos, size)
        .map_err(|e| format!("add_child failed: {e}"))?;

    manager.insert_webview(&tab_id, bounds, webview);
    Ok(())
}

/// Navigate an existing preview child webview to a new URL.
#[tauri::command]
pub async fn preview_navigate(
    tab_id: String,
    url: String,
    manager: State<'_, PreviewManager>,
) -> Result<(), String> {
    let parsed: tauri::Url = url.parse().map_err(|e| format!("bad url: {e}"))?;
    manager
        .with_webview(&tab_id, |wv| wv.navigate(parsed).map_err(|e| e.to_string()))
        .ok_or_else(|| format!("no preview tab {tab_id}"))?
}

/// Reposition and resize the child webview in logical pixels.
#[tauri::command]
pub async fn preview_set_bounds(
    tab_id: String,
    bounds: Bounds,
    manager: State<'_, PreviewManager>,
) -> Result<(), String> {
    manager
        .with_webview(&tab_id, |wv| {
            wv.set_position(tauri::LogicalPosition::new(bounds.x, bounds.y))
                .and_then(|_| wv.set_size(tauri::LogicalSize::new(bounds.w, bounds.h)))
                .map_err(|e| e.to_string())
        })
        .ok_or_else(|| format!("no preview tab {tab_id}"))?
}

/// Show or hide the child webview.
#[tauri::command]
pub async fn preview_set_visible(
    tab_id: String,
    visible: bool,
    manager: State<'_, PreviewManager>,
) -> Result<(), String> {
    manager
        .with_webview(&tab_id, |wv| {
            if visible { wv.show() } else { wv.hide() }.map_err(|e| e.to_string())
        })
        .ok_or_else(|| format!("no preview tab {tab_id}"))?
}

/// Close-before-remove a child webview (mirrors terminal kill-before-remove).
#[tauri::command]
pub async fn preview_destroy(
    tab_id: String,
    manager: State<'_, PreviewManager>,
) -> Result<(), String> {
    if let Some(wv) = manager.take_webview(&tab_id) {
        let _ = wv.close();
    }
    Ok(())
}

/// Capture a PNG screenshot of the child webview.
///
/// macOS: WKWebView `takeSnapshot`, DPR-aware, optionally cropped to `region`.
/// Win/Linux: returns a clean `Err("preview capture unsupported on this platform")`.
///
/// The webview borrow is released before the first `.await` (Finding 1 + 5):
/// `schedule_capture` dispatches the ObjC snapshot call synchronously inside
/// `with_webview`, returns an owned `Receiver`, and we `.await` the receiver
/// outside — no Tokio worker is ever parked for the snapshot duration.
#[tauri::command]
pub async fn preview_capture(
    tab_id: String,
    region: Option<Region>,
    manager: State<'_, PreviewManager>,
) -> Result<Vec<u8>, String> {
    #[cfg(target_os = "macos")]
    {
        // Phase 1 (sync): schedule the snapshot and get back an owned Receiver.
        // The &tauri::Webview borrow is released here, before any .await.
        let rx = manager
            .with_webview(&tab_id, capture_macos::schedule_capture)
            .ok_or_else(|| format!("no preview tab {tab_id}"))??;

        // Phase 2 (async): suspend until the ObjC completion handler fires.
        let (rgba, img_w, img_h, dpr) = rx
            .await
            .map_err(|_| "snapshot oneshot sender dropped before completion".to_string())??;

        // Phase 3: crop/encode (same path as before).
        match region {
            None => capture_macos::encode_png(&rgba, img_w, img_h),
            Some(r) => {
                use crate::preview::crop::{clamp_rect, scale_region};
                let rect = clamp_rect(scale_region(r, dpr), img_w, img_h);
                if rect.w == 0 || rect.h == 0 {
                    return Err("capture region is empty after clamping".to_string());
                }
                let cropped = capture_macos::crop_rgba(&rgba, img_w, rect);
                capture_macos::encode_png(&cropped, rect.w, rect.h)
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (tab_id, region, manager);
        Err("preview capture unsupported on this platform".to_string())
    }
}

/// Evaluate JavaScript in the child webview (fire-and-forget).
/// Used by `PreviewInstance` to install/cancel the inspect picker.
#[tauri::command]
pub async fn preview_eval(
    tab_id: String,
    js: String,
    manager: State<'_, PreviewManager>,
) -> Result<(), String> {
    manager
        .with_webview(&tab_id, |wv| wv.eval(&js).map_err(|e| e.to_string()))
        .ok_or_else(|| format!("no preview tab {tab_id}"))?
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── PreviewManager bookkeeping ────────────────────────────────────────────

    #[test]
    fn create_registers_tab_and_is_idempotent() {
        let mgr = PreviewManager::new();
        assert!(mgr.register("tab-1", Bounds { x: 0.0, y: 0.0, w: 100.0, h: 100.0 }));
        // Second register for the same id is a no-op (idempotent), returns false.
        assert!(!mgr.register("tab-1", Bounds { x: 0.0, y: 0.0, w: 100.0, h: 100.0 }));
        assert_eq!(mgr.count(), 1);
    }

    #[test]
    fn destroy_removes_tab() {
        let mgr = PreviewManager::new();
        mgr.register("tab-1", Bounds { x: 0.0, y: 0.0, w: 10.0, h: 10.0 });
        assert!(mgr.unregister("tab-1"));
        assert!(!mgr.unregister("tab-1")); // already gone
        assert_eq!(mgr.count(), 0);
    }

    #[test]
    fn lock_is_poison_safe() {
        let mgr = std::sync::Arc::new(PreviewManager::new());
        let m2 = mgr.clone();
        let _ = std::thread::spawn(move || {
            let _g = m2.lock_tabs();
            panic!("poison the mutex");
        })
        .join();
        // Must not panic — poison-safe lock recovers the guard.
        mgr.register("after-poison", Bounds { x: 0.0, y: 0.0, w: 1.0, h: 1.0 });
        assert_eq!(mgr.count(), 1);
    }

    // ── Finding 2: URL scheme allowlist ───────────────────────────────────────

    #[test]
    fn allowed_schemes_pass() {
        assert!(is_allowed_external_scheme("https://example.com/path?q=1"));
        assert!(is_allowed_external_scheme("http://localhost:3000"));
        assert!(is_allowed_external_scheme("HTTPS://EXAMPLE.COM")); // case-insensitive
        assert!(is_allowed_external_scheme("HTTP://example.com"));
    }

    #[test]
    fn ide_and_app_schemes_pass() {
        for s in [
            "vscode://open", "vscode-insiders://open", "cursor://x", "jetbrains://x",
            "idea://x", "zed://x", "slack://chan", "linear://x", "notion://x",
            "figma://x", "discord://x", "mailto:a@b.com", "tel:+15551234",
        ] {
            assert!(is_allowed_external_scheme(s), "expected allowed: {s}");
        }
    }

    #[test]
    fn disallowed_schemes_are_rejected() {
        assert!(!is_allowed_external_scheme("file:///etc/passwd"));
        assert!(!is_allowed_external_scheme("javascript:alert(1)"));
        assert!(!is_allowed_external_scheme("ssh://host"));
        assert!(!is_allowed_external_scheme("app://some.bundle/path"));
        assert!(!is_allowed_external_scheme("ftp://ftp.example.com"));
        assert!(!is_allowed_external_scheme("data:text/html,<h1>hi</h1>"));
        assert!(!is_allowed_external_scheme(""));
    }

    // ── Finding 3: InspectResult deserialization ──────────────────────────────

    /// The BRIDGE_JS inspect handler posts:
    ///   { tabId, selector, rect: {x,y,w,h}, viewport: {w,h} }
    /// Verify that the exact shape round-trips through serde.
    #[test]
    fn inspect_result_deserializes_bridge_json() {
        let json = r#"{
            "tabId": "tab-abc",
            "selector": "body > div:nth-child(2)",
            "rect": { "x": 10.0, "y": 20.0, "w": 300.0, "h": 150.0 },
            "viewport": { "w": 1280.0, "h": 800.0 }
        }"#;
        let result: InspectResult = serde_json::from_str(json).expect("deserialization failed");
        // Finding 3a: snake_case field mapped from camelCase tabId.
        assert_eq!(result.tab_id, "tab-abc");
        assert_eq!(result.selector.as_deref(), Some("body > div:nth-child(2)"));
        let rect = result.rect.expect("rect should be Some");
        assert_eq!(rect.x, 10.0);
        assert_eq!(rect.w, 300.0);
        // Finding 3b: viewport is {w,h} only — no x/y fields required.
        let vp = result.viewport.expect("viewport should be Some");
        assert_eq!(vp.w, 1280.0);
        assert_eq!(vp.h, 800.0);
    }

    /// Escape-key cancel path: all nullable fields are null.
    #[test]
    fn inspect_result_deserializes_cancel_payload() {
        let json = r#"{
            "tabId": "tab-xyz",
            "selector": null,
            "rect": null,
            "viewport": null
        }"#;
        let result: InspectResult = serde_json::from_str(json).expect("cancel payload failed");
        assert_eq!(result.tab_id, "tab-xyz");
        assert!(result.selector.is_none());
        assert!(result.rect.is_none());
        assert!(result.viewport.is_none());
    }

    /// Re-emit serializes back to camelCase so the renderer receives `tabId`.
    #[test]
    fn inspect_result_serializes_to_camel_case() {
        let result = InspectResult {
            tab_id: "tab-1".to_string(),
            selector: None,
            rect: None,
            viewport: Some(Viewport { w: 800.0, h: 600.0 }),
        };
        let json = serde_json::to_string(&result).expect("serialization failed");
        assert!(json.contains("\"tabId\""), "expected camelCase tabId, got: {json}");
        assert!(!json.contains("\"tab_id\""), "snake_case leaked into JSON: {json}");
    }

    // ── Finding 3: RegionSelectResult deserialization ─────────────────────────

    /// The BRIDGE_JS region picker posts: { tabId, region: {x,y,w,h} }.
    #[test]
    fn region_result_deserializes_bridge_json() {
        let json = r#"{ "tabId": "tab-r", "region": { "x": 5.0, "y": 6.0, "w": 100.0, "h": 50.0 } }"#;
        let result: RegionSelectResult = serde_json::from_str(json).expect("deserialization failed");
        assert_eq!(result.tab_id, "tab-r");
        let r = result.region.expect("region should be Some");
        assert_eq!(r.x, 5.0);
        assert_eq!(r.y, 6.0);
        assert_eq!(r.w, 100.0);
        assert_eq!(r.h, 50.0);
    }

    /// Cancel payload: region is null.
    #[test]
    fn region_result_deserializes_cancel_payload() {
        let json = r#"{ "tabId": "tab-r", "region": null }"#;
        let result: RegionSelectResult = serde_json::from_str(json).expect("cancel payload failed");
        assert_eq!(result.tab_id, "tab-r");
        assert!(result.region.is_none());
    }

    /// Re-emit serializes back to camelCase tabId.
    #[test]
    fn region_result_serializes_to_camel_case() {
        let result = RegionSelectResult { tab_id: "tab-1".to_string(), region: None };
        let json = serde_json::to_string(&result).expect("serialization failed");
        assert!(json.contains("\"tabId\""), "expected camelCase tabId, got: {json}");
        assert!(!json.contains("\"tab_id\""), "snake_case leaked: {json}");
    }

    // ── NavigateResult (re)serialization ──────────────────────────────────────

    #[test]
    fn navigate_result_deserializes_bridge_json() {
        let json = r#"{ "tabId": "preview-1", "url": "http://localhost:3000/x" }"#;
        let result: NavigateResult = serde_json::from_str(json).expect("deserialization failed");
        assert_eq!(result.tab_id, "preview-1");
        assert_eq!(result.url, "http://localhost:3000/x");
    }

    #[test]
    fn navigate_result_serializes_to_camel_case() {
        let result = NavigateResult { tab_id: "preview-1".to_string(), url: "http://x/".to_string() };
        let json = serde_json::to_string(&result).expect("serialization failed");
        assert!(json.contains("\"tabId\""), "expected camelCase tabId, got: {json}");
        assert!(!json.contains("\"tab_id\""), "snake_case leaked: {json}");
        assert!(json.contains("\"url\":\"http://x/\""), "url value missing/wrong: {json}");
    }
}
