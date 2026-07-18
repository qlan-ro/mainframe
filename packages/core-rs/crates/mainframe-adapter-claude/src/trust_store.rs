//! Ported from `packages/core/src/plugins/builtin/claude/trust-store.ts` — the
//! account-identity read only (`readClaudeAccountIdentity`). `writeWorkspaceTrust`
//! is out of this crate's quota-harvester scope and stays unported (see
//! `mainframe-chat::chat_manager` PORT STATUS note).

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
    if let Some(uuid) = account.and_then(|a| a.get("accountUuid")).and_then(|v| v.as_str())
        && !uuid.is_empty()
    {
        return uuid.to_string();
    }
    if let Some(email) = account.and_then(|a| a.get("emailAddress")).and_then(|v| v.as_str())
        && !email.is_empty()
    {
        return email.to_string();
    }
    tracing::info!(path = %path.display(), "claude.json has no oauthAccount identity; unknown");
    CLAUDE_IDENTITY_UNKNOWN.to_string()
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
        let dir = write_claude_json(r#"{"oauthAccount":{"accountUuid":"uuid-123","emailAddress":"a@b.com"}}"#);
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
}

// PORT STATUS: src/plugins/builtin/claude/trust-store.ts — readClaudeAccountIdentity only (49/85 lines)
// confidence: high
// todos: 0
// notes: writeWorkspaceTrust is deliberately unported here (out of the quota
// notes: harvester's scope for this crate; see mainframe-chat::chat_manager's
// notes: PORT STATUS note). Async via tokio::fs (no sync I/O), mirroring the TS
// notes: node:fs/promises reader; ENOENT -> unknown, any other read error or JSON
// notes: parse failure -> the transient sentinel.
