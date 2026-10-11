//! Claude account and workspace-trust state in `~/.claude.json`:
//! `read_claude_account_identity` (quota identity read) and
//! `write_workspace_trust` (workspace-trust persistence, wired through
//! `mainframe-chat::ChatManager::trust_workspace`).

use std::path::{Path, PathBuf};

/// Keyless/unidentifiable account -> a fixed synthetic bucket (carries no quota).
pub const CLAUDE_IDENTITY_UNKNOWN: &str = "unknown";
/// A transient read failure (lock, torn write) -> the engine reuses the last-known identity.
pub const CLAUDE_IDENTITY_TRANSIENT: &str = "transient:identity-read-failed";

fn default_claude_json_path() -> PathBuf {
    dirs::home_dir().unwrap_or_default().join(".claude.json")
}

/// Resolve the logged-in Claude account identity from `~/.claude.json` (plaintext,
/// no keychain, no OAuth token). Returns `oauthAccount.accountUuid`, falling back
/// to `emailAddress`. A missing file or a config with no `oauthAccount` yields
/// `CLAUDE_IDENTITY_UNKNOWN` (degrade safe); a read/parse failure yields
/// `CLAUDE_IDENTITY_TRANSIENT` so a momentary file lock never flips a healthy
/// gauge to the wrong account.
pub async fn read_claude_account_identity(claude_json_path: Option<&Path>) -> String {
    let path = claude_json_path
        .map(Path::to_path_buf)
        .unwrap_or_else(default_claude_json_path);

    let raw = match tokio::fs::read_to_string(&path).await {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            tracing::info!(path = %path.display(), "claude.json missing; account identity unknown");
            return CLAUDE_IDENTITY_UNKNOWN.to_string();
        }
        Err(err) => {
            tracing::warn!(path = %path.display(), %err, "claude.json unreadable; identity transient");
            return CLAUDE_IDENTITY_TRANSIENT.to_string();
        }
    };

    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => {
            tracing::warn!(path = %path.display(), "claude.json malformed; identity transient");
            return CLAUDE_IDENTITY_TRANSIENT.to_string();
        }
    };

    let account = parsed.get("oauthAccount");
    if let Some(uuid) = account
        .and_then(|a| a.get("accountUuid"))
        .and_then(|v| v.as_str())
        && !uuid.is_empty()
    {
        return uuid.to_string();
    }
    if let Some(email) = account
        .and_then(|a| a.get("emailAddress"))
        .and_then(|v| v.as_str())
        && !email.is_empty()
    {
        return email.to_string();
    }
    tracing::info!(path = %path.display(), "claude.json has no oauthAccount identity; unknown");
    CLAUDE_IDENTITY_UNKNOWN.to_string()
}

/// Failure modes for [`write_workspace_trust`]. A missing file is tolerated
/// (treated as an empty config); every other read/parse/write failure is
/// surfaced rather than silently clobbering login/other-project data.
#[derive(Debug, thiserror::Error)]
pub enum TrustStoreError {
    #[error("failed to read {path}: {source}")]
    Read {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("claude.json at {path} is not valid JSON: {source}")]
    Parse {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },
    #[error("failed to serialize claude.json: {0}")]
    Serialize(serde_json::Error),
    #[error("failed to write {path}: {source}")]
    Write {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
}

/// Marks a project as trusted in `~/.claude.json` (the CLI's per-project trust
/// store), so Claude stops ignoring the project's `permissions.allow` entries.
/// Read-modify-write with an atomic rename; preserves all other keys. Only a
/// missing file is tolerated — a corrupt/unreadable existing file errors rather
/// than clobbering login/other projects.
pub async fn write_workspace_trust(
    project_path: &str,
    claude_json_path: Option<&Path>,
) -> Result<(), TrustStoreError> {
    let path = claude_json_path
        .map(Path::to_path_buf)
        .unwrap_or_else(default_claude_json_path);

    let mut config = match tokio::fs::read_to_string(&path).await {
        Ok(raw) => serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&raw)
            .map_err(|source| TrustStoreError::Parse {
                path: path.clone(),
                source,
            })?,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            tracing::info!(path = %path.display(), "claude.json missing; creating on first trust");
            serde_json::Map::new()
        }
        Err(source) => {
            return Err(TrustStoreError::Read {
                path: path.clone(),
                source,
            });
        }
    };

    let mut projects = match config.remove("projects") {
        Some(serde_json::Value::Object(m)) => m,
        _ => serde_json::Map::new(),
    };
    let mut entry = match projects.remove(project_path) {
        Some(serde_json::Value::Object(m)) => m,
        _ => serde_json::Map::new(),
    };
    entry.insert("hasTrustDialogAccepted".to_string(), true.into());
    projects.insert(project_path.to_string(), entry.into());
    config.insert("projects".to_string(), projects.into());

    let body = serde_json::to_string_pretty(&config).map_err(TrustStoreError::Serialize)?;
    mainframe_runtime::fs::write_atomic(&path, body.as_bytes(), false)
        .await
        .map_err(|error| TrustStoreError::Write {
            path: error.path,
            source: error.source,
        })?;
    tracing::info!(project_path, "workspace trusted");
    Ok(())
}

#[cfg(test)]
#[path = "trust_store_tests.rs"]
mod tests;
