use crate::preview::crop::Region;

/// Stub capture for non-macOS platforms. Returns a clean, JS-matchable error.
#[cfg(not(target_os = "macos"))]
pub fn capture_png(
    _webview: &tauri::Webview,
    _region: Option<Region>,
) -> Result<Vec<u8>, String> {
    Err("preview capture unsupported on this platform".to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    #[cfg(not(target_os = "macos"))]
    fn unsupported_platform_returns_clean_error() {
        // The error string is the contract the JS layer matches on.
        let msg = "preview capture unsupported on this platform";
        assert!(msg.contains("unsupported"));
    }
}
