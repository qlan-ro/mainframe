//! Zod schemas for every host command payload + event. The single source of
//! payload shapes: the Electron ipcMain handlers parse args with these; the Rust
//! (Tauri) shell conforms via serde to the same documented contract. Platform /
//! DaemonStatus enums are defined HERE and re-exported from host_bridge.

use crate::validation::RefinementError;
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
    pub fn validate(&self) -> Result<(), RefinementError> {
        if self.id.is_empty() || self.cwd.is_empty() {
            return Err(RefinementError::Empty("id and cwd"));
        }
        if self.cols <= 0 || self.rows <= 0 {
            return Err(RefinementError::NotPositive("cols and rows"));
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
#[path = "host_contract_tests.rs"]
mod tests;
