//! Ported from `packages/core/src/plugins/builtin/codex/quota-identity.ts`.
//!
//! Resolves the logged-in Codex account identity: `account/read`'s email first,
//! then `~/.codex/auth.json`'s `tokens.account_id`, then a synthetic
//! `apiKey`/`bedrock` bucket for keyless auth. A transient RPC or file-read
//! failure yields `CODEX_IDENTITY_TRANSIENT` so a momentary hiccup never flips a
//! healthy gauge to the wrong account.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;

use mainframe_adapter_api::AdapterError;
use serde::Deserialize;

use crate::types::Account;

/// No account and no fallback identified it -> a fixed synthetic bucket (carries no quota anyway).
pub const CODEX_IDENTITY_UNKNOWN: &str = "unknown";
/// A transient read failure (RPC error, locked/unreadable auth.json) -> reuse the last-known identity.
pub const CODEX_IDENTITY_TRANSIENT: &str = "transient:identity-read-failed";

#[derive(Debug, Deserialize)]
pub(crate) struct CodexAuthFile {
    tokens: Option<AuthTokens>,
}

#[derive(Debug, Deserialize)]
struct AuthTokens {
    account_id: Option<String>,
}

/// Also reused by `quota_pull` as the `readAccount` seam over a live app-server connection.
pub type ReadAccount = dyn Fn() -> Pin<Box<dyn Future<Output = Result<Option<Account>, AdapterError>> + Send>>
    + Send
    + Sync;
pub(crate) type ReadAuthFile = dyn Fn() -> Pin<Box<dyn Future<Output = Result<Option<CodexAuthFile>, AdapterError>> + Send>>
    + Send
    + Sync;

/// Injected dependencies so tests need no real app-server connection or filesystem read.
pub(crate) struct ReadCodexAccountIdentityDeps<'a> {
    /// `account/read` over the app-server connection already in use for the quota pull.
    pub read_account: &'a ReadAccount,
    /// Plaintext fallback when the account has no usable email. `None` uses the
    /// `~/.codex/auth.json` reader.
    pub read_auth_file: Option<&'a ReadAuthFile>,
}

pub(crate) async fn read_codex_account_identity(deps: ReadCodexAccountIdentityDeps<'_>) -> String {
    let account = match (deps.read_account)().await {
        Ok(account) => account,
        Err(err) => {
            tracing::warn!(%err, "codex account/read failed; identity transient");
            return CODEX_IDENTITY_TRANSIENT.to_string();
        }
    };

    if let Some(Account::Chatgpt {
        email: Some(email), ..
    }) = &account
        && !email.is_empty()
    {
        return email.clone();
    }

    let auth_file = match deps.read_auth_file {
        Some(read_auth_file) => read_auth_file().await,
        None => read_default_auth_file(&default_auth_json_path()).await,
    };
    let auth_file = match auth_file {
        Ok(auth_file) => auth_file,
        Err(err) => {
            tracing::warn!(%err, "codex auth.json unreadable; identity transient");
            return CODEX_IDENTITY_TRANSIENT.to_string();
        }
    };

    let account_id = auth_file.and_then(|f| f.tokens).and_then(|t| t.account_id);
    if let Some(account_id) = account_id
        && !account_id.is_empty()
    {
        return account_id;
    }

    synthetic_bucket(account.as_ref())
}

fn synthetic_bucket(account: Option<&Account>) -> String {
    match account {
        Some(Account::ApiKey) => "apiKey".to_string(),
        Some(Account::AmazonBedrock { .. }) => "bedrock".to_string(),
        _ => {
            tracing::info!(?account, "codex: no identifiable account; identity unknown");
            CODEX_IDENTITY_UNKNOWN.to_string()
        }
    }
}

fn default_auth_json_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".codex")
        .join("auth.json")
}

/// ENOENT (no auth.json) is not a failure — it just yields no account-id fallback.
async fn read_default_auth_file(path: &Path) -> Result<Option<CodexAuthFile>, AdapterError> {
    let raw = match tokio::fs::read_to_string(path).await {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(AdapterError::from(err)),
    };
    let parsed: CodexAuthFile =
        serde_json::from_str(&raw).map_err(|err| AdapterError::Message(err.to_string()))?;
    Ok(Some(parsed))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account_ok(account: Option<Account>) -> Box<ReadAccount> {
        Box::new(move || {
            let account = account.clone();
            Box::pin(async move { Ok(account) })
        })
    }
    fn account_err() -> Box<ReadAccount> {
        Box::new(|| Box::pin(async { Err(AdapterError::Message("app-server unreachable".into())) }))
    }
    fn auth_file_ok(account_id: Option<&'static str>) -> Box<ReadAuthFile> {
        Box::new(move || {
            Box::pin(async move {
                Ok(Some(CodexAuthFile {
                    tokens: Some(AuthTokens {
                        account_id: account_id.map(str::to_string),
                    }),
                }))
            })
        })
    }
    fn auth_file_none() -> Box<ReadAuthFile> {
        Box::new(|| Box::pin(async { Ok(None) }))
    }
    fn auth_file_err() -> Box<ReadAuthFile> {
        Box::new(|| Box::pin(async { Err(AdapterError::Message("EACCES".into())) }))
    }

    #[tokio::test]
    async fn returns_the_account_read_email_for_a_chatgpt_account() {
        let read_account = account_ok(Some(Account::Chatgpt {
            email: Some("a@b.com".into()),
            plan_type: Some("plus".into()),
        }));
        let identity = read_codex_account_identity(ReadCodexAccountIdentityDeps {
            read_account: &read_account,
            read_auth_file: None,
        })
        .await;
        assert_eq!(identity, "a@b.com");
    }

    #[tokio::test]
    async fn falls_back_to_auth_json_account_id_when_the_chatgpt_account_has_no_email() {
        let read_account = account_ok(Some(Account::Chatgpt {
            email: None,
            plan_type: Some("plus".into()),
        }));
        let read_auth_file = auth_file_ok(Some("uuid-456"));
        let identity = read_codex_account_identity(ReadCodexAccountIdentityDeps {
            read_account: &read_account,
            read_auth_file: Some(&read_auth_file),
        })
        .await;
        assert_eq!(identity, "uuid-456");
    }

    #[tokio::test]
    async fn returns_a_synthetic_api_key_bucket_when_there_is_no_email_and_no_auth_json_fallback() {
        let read_account = account_ok(Some(Account::ApiKey));
        let read_auth_file = auth_file_none();
        let identity = read_codex_account_identity(ReadCodexAccountIdentityDeps {
            read_account: &read_account,
            read_auth_file: Some(&read_auth_file),
        })
        .await;
        assert_eq!(identity, "apiKey");
    }

    #[tokio::test]
    async fn returns_a_synthetic_bedrock_bucket_for_amazon_bedrock_accounts() {
        let read_account = account_ok(Some(Account::AmazonBedrock {
            credential_source: Some("env".into()),
        }));
        let read_auth_file = auth_file_none();
        let identity = read_codex_account_identity(ReadCodexAccountIdentityDeps {
            read_account: &read_account,
            read_auth_file: Some(&read_auth_file),
        })
        .await;
        assert_eq!(identity, "bedrock");
    }

    #[tokio::test]
    async fn returns_the_unknown_bucket_when_there_is_no_account_at_all() {
        let read_account = account_ok(None);
        let read_auth_file = auth_file_none();
        let identity = read_codex_account_identity(ReadCodexAccountIdentityDeps {
            read_account: &read_account,
            read_auth_file: Some(&read_auth_file),
        })
        .await;
        assert_eq!(identity, CODEX_IDENTITY_UNKNOWN);
    }

    #[tokio::test]
    async fn returns_the_transient_sentinel_when_account_read_fails() {
        let read_account = account_err();
        let identity = read_codex_account_identity(ReadCodexAccountIdentityDeps {
            read_account: &read_account,
            read_auth_file: None,
        })
        .await;
        assert_eq!(identity, CODEX_IDENTITY_TRANSIENT);
    }

    #[tokio::test]
    async fn returns_the_transient_sentinel_when_auth_json_is_present_but_unreadable() {
        let read_account = account_ok(Some(Account::ApiKey));
        let read_auth_file = auth_file_err();
        let identity = read_codex_account_identity(ReadCodexAccountIdentityDeps {
            read_account: &read_account,
            read_auth_file: Some(&read_auth_file),
        })
        .await;
        assert_eq!(identity, CODEX_IDENTITY_TRANSIENT);
    }
}

// PORT STATUS: src/plugins/builtin/codex/quota-identity.ts (75 lines)
// confidence: high
// todos: 0
// notes: readAccount/readAuthFile are injected as boxed async closures returning
// notes: Result (Rust has no bare try/catch, so the TS try/catch-to-transient-
// notes: sentinel branches become Err arms) mirroring quota_pull's deps seam.
// notes: CodexAuthFile/AuthTokens stay module-private, matching the TS file's
// notes: locally-scoped interface (not exported via types.ts).
