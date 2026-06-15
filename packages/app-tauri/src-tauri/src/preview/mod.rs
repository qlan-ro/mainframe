pub mod bridge;
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

#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
pub struct InspectResult {
    pub tab_id: String,
    pub selector: Option<String>,
    pub rect: Option<Bounds>,
    pub viewport: Option<Bounds>,
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
    let builder =
        tauri::webview::WebviewBuilder::new(&tab_id, WebviewUrl::External(parsed))
            .initialization_script(crate::preview::bridge::BRIDGE_JS);

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
#[tauri::command]
pub async fn preview_capture(
    tab_id: String,
    region: Option<Region>,
    manager: State<'_, PreviewManager>,
) -> Result<Vec<u8>, String> {
    #[cfg(target_os = "macos")]
    {
        manager
            .with_webview(&tab_id, |wv| capture_macos::capture_png(wv, region))
            .ok_or_else(|| format!("no preview tab {tab_id}"))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (tab_id, region, manager);
        Err("preview capture unsupported on this platform".to_string())
    }
}

/// Open a URL in the OS default browser (called from the BRIDGE_JS click handler).
#[tauri::command]
pub async fn preview_open_external(url: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// Receive the inspect-picker result from the injected BRIDGE_JS and re-emit
/// it as a Tauri event that `PreviewInstance` can listen to.
#[tauri::command]
pub async fn preview_inspect_result(
    result: InspectResult,
    app: tauri::AppHandle,
) -> Result<(), String> {
    use tauri::Emitter;
    app.emit("preview:inspect-result", &result).map_err(|e| e.to_string())
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
}
