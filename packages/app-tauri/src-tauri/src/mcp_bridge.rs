//! Explicit registration for the tauri-mcp bridge plugin, split by feature so the
//! dev and packaged-QA targets get different, deterministic loopback endpoints
//! instead of the plugin's default (`0.0.0.0:9223` with an upward port scan).
//! See docs/plans/2026-08-10-todo-318-packaged-tauri-qa-bridge-plan.md.

use tauri::ipc::CapabilityBuilder;
use tauri::Manager;

pub const BIND_ADDRESS: &str = "127.0.0.1";
pub const DEV_BASE_PORT: u16 = 9223;
pub const QA_BASE_PORT: u16 = 9323;

/// The base port for this build: the QA feature's dedicated port when compiled
/// with `mcp-bridge-qa`, the dev port otherwise. Kept outside the plugin's
/// 100-port scan window so a QA session can never latch onto a dev app.
#[cfg(feature = "mcp-bridge-qa")]
pub fn base_port() -> u16 {
    QA_BASE_PORT
}

#[cfg(not(feature = "mcp-bridge-qa"))]
pub fn base_port() -> u16 {
    DEV_BASE_PORT
}

pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_mcp_bridge::Builder::new()
        .bind_address(BIND_ADDRESS)
        .base_port(base_port())
        .build()
}

/// Grant the mcp-bridge capability at runtime so it is absent from the static
/// capability set that ships in release builds.
pub fn grant_capability(app: &tauri::AppHandle) {
    if let Err(e) = app.add_capability(
        CapabilityBuilder::new("dev-mcp-bridge")
            .window("main")
            .permission("mcp-bridge:default"),
    ) {
        tracing::warn!(err = %e, "failed to add dev-mcp-bridge capability");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bind_address_is_loopback() {
        assert_eq!(BIND_ADDRESS, "127.0.0.1");
    }

    #[test]
    fn dev_and_qa_base_ports_differ() {
        assert_ne!(DEV_BASE_PORT, QA_BASE_PORT);
    }

    #[test]
    fn qa_base_port_sits_outside_the_dev_scan_window() {
        // The plugin's port scan and the server's discovery range are both
        // 100 wide, starting at the dev base port.
        assert!(!(DEV_BASE_PORT..DEV_BASE_PORT + 100).contains(&QA_BASE_PORT));
    }
}
