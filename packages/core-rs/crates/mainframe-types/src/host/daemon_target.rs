use crate::validation::RefinementError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DaemonKind {
    Local,
    Remote,
}

/// The scheme a daemon was paired with. Absent on a `DaemonMeta` means https.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DaemonScheme {
    Http,
    Https,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonTarget {
    pub id: String,
    pub kind: DaemonKind,
    pub label: String,
    /// 'http://127.0.0.1:<port>' | 'https://<tunnel-host>'.
    pub base_url: String,
    /// null => loopback trust (local); JWT => remote bearer.
    pub token: Option<String>,
}

/// Persisted registry shape — NEVER carries a token (tokens live in the
/// keyring/safeStorage). `host` is the bare host[:port]; baseUrl is derived.
/// Mirrors `DaemonMetaSchema`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DaemonMeta {
    pub id: String,
    pub kind: DaemonKind,
    pub label: String,
    pub host: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paired: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheme: Option<DaemonScheme>,
}

impl DaemonMeta {
    /// The `.min(1)` refinements from `DaemonMetaSchema` (id/label/host non-empty).
    pub fn validate(&self) -> Result<(), RefinementError> {
        if self.id.is_empty() {
            return Err(RefinementError::TooShort("id"));
        }
        if self.label.is_empty() {
            return Err(RefinementError::TooShort("label"));
        }
        if self.host.is_empty() {
            return Err(RefinementError::TooShort("host"));
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "daemon_target_tests.rs"]
mod tests;
