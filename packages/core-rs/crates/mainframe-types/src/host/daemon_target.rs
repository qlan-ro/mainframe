//! Ported from `packages/types/src/host/daemon-target.ts`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DaemonKind {
    Local,
    Remote,
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
}

impl DaemonMeta {
    /// The `.min(1)` refinements from `DaemonMetaSchema` (id/label/host non-empty).
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty() {
            return Err("id must contain at least 1 character".to_string());
        }
        if self.label.is_empty() {
            return Err("label must contain at least 1 character".to_string());
        }
        if self.host.is_empty() {
            return Err("host must contain at least 1 character".to_string());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daemon_target_serializes_null_token() {
        let json = r#"{"id":"local","kind":"local","label":"This Mac","baseUrl":"http://127.0.0.1:31415","token":null}"#;
        let t: DaemonTarget = serde_json::from_str(json).unwrap();
        assert_eq!(t.kind, DaemonKind::Local);
        assert!(t.token.is_none());
        assert_eq!(serde_json::to_string(&t).unwrap(), json);
    }

    #[test]
    fn daemon_meta_omits_optionals_and_validates() {
        let json =
            r#"{"id":"remote-1","kind":"remote","label":"Server","host":"box.example:31415"}"#;
        let m: DaemonMeta = serde_json::from_str(json).unwrap();
        assert!(m.validate().is_ok());
        assert_eq!(serde_json::to_string(&m).unwrap(), json);
    }

    #[test]
    fn daemon_meta_validate_rejects_empty_host() {
        let m = DaemonMeta {
            id: "x".to_string(),
            kind: DaemonKind::Local,
            label: "l".to_string(),
            host: String::new(),
            device: None,
            paired: None,
        };
        assert!(m.validate().is_err());
    }
}

// PORT STATUS: packages/types/src/host/daemon-target.ts (23 lines)
// confidence: high
// todos: 0
// notes: host bridge/registry type — not daemon-consumed (low priority per §2.1).
// `kind` literal-union → DaemonKind enum, shared by DaemonTarget and DaemonMeta.
// `token: string | null` is required-nullable → Option WITHOUT skip. DaemonMeta
// mirrors DaemonMetaSchema (zod); the `.min(1)` refinements become validate().
