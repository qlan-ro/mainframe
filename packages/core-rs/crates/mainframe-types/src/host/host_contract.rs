//! Ported from `packages/types/src/host/host-contract.ts`.
//!
//! Zod schemas for every host command payload + event. The single source of
//! payload shapes: the Electron ipcMain handlers parse args with these; the Rust
//! (Tauri) shell conforms via serde to the same documented contract. Platform /
//! DaemonStatus enums are defined HERE and re-exported from host_bridge.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Macos,
    Windows,
    Linux,
    Browser,
}

/// Daemon lifecycle vocabulary (see the TS doc comment for the full state list).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DaemonStatus {
    Initializing,
    Starting,
    Ready,
    Unavailable,
    Stopped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppInfo {
    pub version: String,
    pub author: String,
    pub homedir: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerminalCreateOpts {
    pub id: String,
    pub cwd: String,
    pub cols: i64,
    pub rows: i64,
}

impl TerminalCreateOpts {
    /// `id`/`cwd` non-empty; `cols`/`rows` positive integers.
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty() || self.cwd.is_empty() {
            return Err("id and cwd must be non-empty".to_string());
        }
        if self.cols <= 0 || self.rows <= 0 {
            return Err("cols and rows must be positive".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerminalWrite {
    pub id: String,
    pub data: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerminalResize {
    pub id: String,
    pub cols: i64,
    pub rows: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerminalId {
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Notify {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearSession {
    pub project_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Region {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LogRecord {
    pub level: LogLevel,
    pub module: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// Auto-update lifecycle. Mirrors the Electron UpdateStatus union (6 variants);
/// discriminated on `state`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state")]
pub enum UpdateStatus {
    #[serde(rename = "checking")]
    Checking,
    #[serde(rename = "available")]
    Available { version: String },
    #[serde(rename = "not-available")]
    NotAvailable,
    #[serde(rename = "downloading")]
    Downloading { percent: f64 },
    #[serde(rename = "downloaded")]
    Downloaded { version: String },
    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PresenceState {
    Active,
    Idle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Presence {
    pub state: PresenceState,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_accepts_known_rejects_others() {
        assert_eq!(
            serde_json::from_str::<Platform>("\"macos\"").unwrap(),
            Platform::Macos
        );
        assert!(serde_json::from_str::<Platform>("\"freebsd\"").is_err());
    }

    #[test]
    fn daemon_status_closed_vocabulary() {
        assert_eq!(
            serde_json::from_str::<DaemonStatus>("\"ready\"").unwrap(),
            DaemonStatus::Ready
        );
        assert!(serde_json::from_str::<DaemonStatus>("\"green\"").is_err());
    }

    #[test]
    fn terminal_create_opts_requires_all_fields() {
        let json = r#"{"id":"t1","cwd":"/tmp","cols":80,"rows":24}"#;
        let opts: TerminalCreateOpts = serde_json::from_str(json).unwrap();
        assert!(opts.validate().is_ok());
        assert_eq!(serde_json::to_string(&opts).unwrap(), json);
        assert!(serde_json::from_str::<TerminalCreateOpts>(r#"{"id":"t1","cwd":"/tmp"}"#).is_err());
    }

    #[test]
    fn terminal_create_opts_validate_rejects_nonpositive() {
        let opts = TerminalCreateOpts {
            id: "t1".to_string(),
            cwd: "/tmp".to_string(),
            cols: 0,
            rows: 24,
        };
        assert!(opts.validate().is_err());
    }

    #[test]
    fn notify_body_optional() {
        assert_eq!(
            serde_json::to_string(&Notify {
                title: "hi".to_string(),
                body: None
            })
            .unwrap(),
            r#"{"title":"hi"}"#
        );
    }

    #[test]
    fn log_record_rejects_unknown_level() {
        assert!(
            serde_json::from_str::<LogRecord>(
                r#"{"level":"verbose","module":"m","message":"msg"}"#
            )
            .is_err()
        );
        let ok: LogRecord =
            serde_json::from_str(r#"{"level":"info","module":"m","message":"msg"}"#).unwrap();
        assert_eq!(ok.level, LogLevel::Info);
    }

    #[test]
    fn update_status_discriminated_on_state() {
        let json = r#"{"state":"downloading","percent":42.5}"#;
        let s: UpdateStatus = serde_json::from_str(json).unwrap();
        assert!(matches!(s, UpdateStatus::Downloading { .. }));
        assert_eq!(serde_json::to_string(&s).unwrap(), json);

        let na = r#"{"state":"not-available"}"#;
        let s: UpdateStatus = serde_json::from_str(na).unwrap();
        assert!(matches!(s, UpdateStatus::NotAvailable));
        assert_eq!(serde_json::to_string(&s).unwrap(), na);
    }
}

// PORT STATUS: packages/types/src/host/host-contract.ts (104 lines)
// confidence: high
// todos: 0
// notes: host bridge contract — not daemon-consumed (low priority per §2.1). Zod
// enums → serde enums; zod objects → structs. The `.min(1)` / `.int().positive()`
// refinements that serde can't express (TerminalCreateOpts) become validate().
// cols/rows → i64 (int().positive()); Region x/y/w/h and Downloading.percent → f64
// (plain z.number(), may be fractional). UpdateStatus is a discriminatedUnion on
// `state` → internally-tagged enum. FilePathSchema/OpenExternalSchema are bare
// `z.string().min(1)` aliases with no struct to hang on — callers validate the
// string inline, so no Rust item is emitted for them.
