//! Ported from `packages/core/src/plugins/builtin/claude/trust-store.ts` — both
//! `readClaudeAccountIdentity` (quota identity read) and `writeWorkspaceTrust`
//! (workspace-trust persistence, wired through `mainframe-chat::ChatManager::
//! trust_workspace`).

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

    // Unique per call (not just per process) so two concurrent trust writes
    // never share a tmp file and clobber or steal each other's rename.
    let mut tmp = path.clone().into_os_string();
    tmp.push(format!(".tmp-{}-{}", std::process::id(), nanoid::nanoid!()));
    let tmp = PathBuf::from(tmp);
    let body = serde_json::to_string_pretty(&config).map_err(TrustStoreError::Serialize)?;

    let result = write_and_rename(&tmp, &path, &body).await;
    // No-op once the rename above has succeeded; only cleans up an orphan
    // left behind when the write/rename above failed partway through.
    let _ = tokio::fs::remove_file(&tmp).await;

    result?;
    tracing::info!(project_path, "workspace trusted");
    Ok(())
}

async fn write_and_rename(tmp: &Path, dest: &Path, body: &str) -> Result<(), TrustStoreError> {
    tokio::fs::write(tmp, body)
        .await
        .map_err(|source| TrustStoreError::Write {
            path: tmp.to_path_buf(),
            source,
        })?;
    tokio::fs::rename(tmp, dest)
        .await
        .map_err(|source| TrustStoreError::Write {
            path: dest.to_path_buf(),
            source,
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_claude_json(contents: &str) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let mut f = std::fs::File::create(dir.path().join(".claude.json")).unwrap();
        f.write_all(contents.as_bytes()).unwrap();
        dir
    }

    #[tokio::test]
    async fn returns_the_oauth_account_uuid_when_present() {
        let dir = write_claude_json(
            r#"{"oauthAccount":{"accountUuid":"uuid-123","emailAddress":"a@b.com"}}"#,
        );
        let identity = read_claude_account_identity(Some(&dir.path().join(".claude.json"))).await;
        assert_eq!(identity, "uuid-123");
    }

    #[tokio::test]
    async fn falls_back_to_email_address_when_account_uuid_is_absent() {
        let dir = write_claude_json(r#"{"oauthAccount":{"emailAddress":"a@b.com"}}"#);
        let identity = read_claude_account_identity(Some(&dir.path().join(".claude.json"))).await;
        assert_eq!(identity, "a@b.com");
    }

    #[tokio::test]
    async fn returns_the_unknown_bucket_when_there_is_no_oauth_account() {
        let dir = write_claude_json(r#"{"projects":{}}"#);
        let identity = read_claude_account_identity(Some(&dir.path().join(".claude.json"))).await;
        assert_eq!(identity, CLAUDE_IDENTITY_UNKNOWN);
    }

    #[tokio::test]
    async fn returns_the_unknown_bucket_when_the_file_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        let identity = read_claude_account_identity(Some(&dir.path().join("absent.json"))).await;
        assert_eq!(identity, CLAUDE_IDENTITY_UNKNOWN);
    }

    #[tokio::test]
    async fn returns_the_transient_sentinel_when_the_file_is_malformed_json() {
        let dir = write_claude_json("{ not json");
        let identity = read_claude_account_identity(Some(&dir.path().join(".claude.json"))).await;
        assert_eq!(identity, CLAUDE_IDENTITY_TRANSIENT);
    }

    #[tokio::test]
    async fn write_workspace_trust_creates_the_file_when_it_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".claude.json");

        write_workspace_trust("/home/me/proj", Some(&path))
            .await
            .unwrap();

        let raw = tokio::fs::read_to_string(&path).await.unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(
            parsed["projects"]["/home/me/proj"]["hasTrustDialogAccepted"],
            true
        );
    }

    #[tokio::test]
    async fn write_workspace_trust_preserves_other_keys_and_other_projects() {
        let dir = write_claude_json(
            r#"{"oauthAccount":{"accountUuid":"uuid-123"},"projects":{"/other":{"hasTrustDialogAccepted":true,"allowedTools":["Bash"]}}}"#,
        );
        let path = dir.path().join(".claude.json");

        write_workspace_trust("/home/me/proj", Some(&path))
            .await
            .unwrap();

        let raw = tokio::fs::read_to_string(&path).await.unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed["oauthAccount"]["accountUuid"], "uuid-123");
        assert_eq!(
            parsed["projects"]["/other"]["hasTrustDialogAccepted"],
            true
        );
        assert_eq!(parsed["projects"]["/other"]["allowedTools"][0], "Bash");
        assert_eq!(
            parsed["projects"]["/home/me/proj"]["hasTrustDialogAccepted"],
            true
        );
    }

    #[tokio::test]
    async fn write_workspace_trust_preserves_other_fields_on_the_same_project() {
        let dir = write_claude_json(
            r#"{"projects":{"/home/me/proj":{"allowedTools":["Bash"]}}}"#,
        );
        let path = dir.path().join(".claude.json");

        write_workspace_trust("/home/me/proj", Some(&path))
            .await
            .unwrap();

        let raw = tokio::fs::read_to_string(&path).await.unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed["projects"]["/home/me/proj"]["allowedTools"][0], "Bash");
        assert_eq!(
            parsed["projects"]["/home/me/proj"]["hasTrustDialogAccepted"],
            true
        );
    }

    #[tokio::test]
    async fn write_workspace_trust_errors_on_malformed_existing_file_without_clobbering_it() {
        let dir = write_claude_json("{ not json");
        let path = dir.path().join(".claude.json");

        let err = write_workspace_trust("/home/me/proj", Some(&path))
            .await
            .unwrap_err();
        assert!(matches!(err, TrustStoreError::Parse { .. }));

        let raw = tokio::fs::read_to_string(&path).await.unwrap();
        assert_eq!(raw, "{ not json");
    }

    #[tokio::test]
    async fn write_workspace_trust_leaves_no_tmp_file_behind_on_success() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".claude.json");

        write_workspace_trust("/home/me/proj", Some(&path))
            .await
            .unwrap();

        let entries: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(entries, vec![std::ffi::OsString::from(".claude.json")]);
    }
}

// PORT STATUS: src/plugins/builtin/claude/trust-store.ts (85/85 lines)
// confidence: high
// todos: 0
// notes: readClaudeAccountIdentity + writeWorkspaceTrust both ported. Async via
// notes: tokio::fs (no sync I/O), mirroring node:fs/promises. write_workspace_trust
// notes: mirrors the TS read-modify-write: ENOENT -> empty config (create on first
// notes: trust), any other read or JSON-parse error propagates (never clobbers an
// notes: existing file); the unique-per-call tmp file + rename is atomic, with a
// notes: best-effort tmp cleanup mirroring the TS try/finally `rm(tmp, {force:true})`.
// notes: One deliberate deviation: object key order in the rewritten JSON follows
// notes: serde_json::Map's default (BTreeMap, alphabetical) rather than JS insertion
// notes: order — this file is a local Claude-CLI config, not a wire contract, so byte-
// notes: for-byte key order was not preserved. Wired via
// notes: mainframe-chat::ChatManager::trust_workspace (chat_manager.rs) and
// notes: POST /api/chats/:id/trust-workspace (mainframe-server::routes::chat_commands).
