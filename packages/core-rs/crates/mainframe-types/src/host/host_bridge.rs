//! Ported from `packages/types/src/host/host-bridge.ts`.
//!
//! The canonical, type-only renderer→host contract. Only the **data** shapes are
//! ported here (Bounds, InspectResult, RegionSelectResult, TerminalOpts,
//! PreviewOpts). The `HostBridge` interface and the handle interfaces
//! (`TerminalHandle`, `PreviewHandle`, `TerminalHandlers`) are async/callback
//! renderer↔host contracts implemented per shell (Tauri/Electron in JS + Rust) and
//! are not daemon-consumed — they are not ported as Rust types.
// TODO(port): HostBridge / TerminalHandle / PreviewHandle / TerminalHandlers are
// behavioral bridge interfaces (Promise-returning methods, DOM handles, callbacks),
// not serde data; they live in the desktop shells, not this crate.

use serde::{Deserialize, Serialize};

pub use super::daemon_target::DaemonMeta;
pub use super::host_contract::{
    AppInfo, DaemonStatus, LogLevel, Platform, PresenceState, Region, UpdateStatus,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectResult {
    pub tab_id: String,
    pub selector: Option<String>,
    pub rect: Option<Bounds>,
    pub viewport: Option<Bounds>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionSelectResult {
    pub tab_id: String,
    /// Selected region in webview-viewport CSS px, or null when cancelled.
    pub region: Option<Region>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerminalOpts {
    pub id: String,
    pub cwd: String,
    pub cols: i64,
    pub rows: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PreviewDevice {
    Desktop,
    Mobile,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PreviewOpts {
    /// Selects the persistent session partition (Electron).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    /// Initial frame; the renderer toggles it via handle.setDevice.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device: Option<PreviewDevice>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inspect_result_serializes_null_fields() {
        let json = r#"{"tabId":"t1","selector":null,"rect":null,"viewport":null}"#;
        let r: InspectResult = serde_json::from_str(json).unwrap();
        assert!(r.selector.is_none());
        assert_eq!(serde_json::to_string(&r).unwrap(), json);
    }

    #[test]
    fn region_select_result_round_trips() {
        let json = r#"{"tabId":"t1","region":{"x":0.0,"y":0.0,"w":100.0,"h":50.0}}"#;
        let r: RegionSelectResult = serde_json::from_str(json).unwrap();
        assert!(r.region.is_some());
        assert_eq!(serde_json::to_string(&r).unwrap(), json);
    }

    #[test]
    fn preview_opts_omits_absent_and_round_trips_device() {
        assert_eq!(
            serde_json::to_string(&PreviewOpts::default()).unwrap(),
            "{}"
        );
        let json = r#"{"device":"mobile"}"#;
        let o: PreviewOpts = serde_json::from_str(json).unwrap();
        assert_eq!(o.device, Some(PreviewDevice::Mobile));
        assert_eq!(serde_json::to_string(&o).unwrap(), json);
    }
}

// PORT STATUS: packages/types/src/host/host-bridge.ts (173 lines)
// confidence: medium
// todos: 1
// notes: host bridge contract — not daemon-consumed (low priority per §2.1). Only
// the plain data structs are ported; the behavioral HostBridge/handle interfaces
// are intentionally omitted (they're per-shell runtime code). The TS type-only
// re-exports (Platform/DaemonStatus/LogLevel/UpdateStatus/PresenceState from
// host-contract, DaemonMeta from daemon-target) become `pub use`; AppInfo/Region
// (z.infer aliases) are re-exported from host_contract. Bounds/Region coords → f64
// (CSS px); TerminalOpts cols/rows → i64. Nullable selector/rect/viewport/region
// are required-nullable → Option WITHOUT skip.
