//! Reads the ChatGPT plan claims Codex saved at login (`auth.json`'s
//! `tokens.id_token`). Only `codex login` rewrites the id token, so a lapsed
//! `chatgpt_subscription_active_until` can also be a renewed plan that the saved
//! login has not picked up yet.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, Utc};
use serde::Deserialize;

const AUTH_CLAIMS: &str = "https://api.openai.com/auth";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ChatgptSubscription {
    pub plan_type: Option<String>,
    pub active_until: Option<DateTime<Utc>>,
}

#[derive(Deserialize)]
struct AuthFile {
    tokens: Option<AuthTokens>,
}

#[derive(Deserialize)]
struct AuthTokens {
    id_token: Option<String>,
}

#[derive(Deserialize)]
struct AuthClaims {
    chatgpt_plan_type: Option<String>,
    chatgpt_subscription_active_until: Option<String>,
}

/// Blocking read of a few-KB file: only the rejected-turn path calls this, from
/// the synchronous notification callback.
pub(crate) fn read_chatgpt_subscription() -> Option<ChatgptSubscription> {
    let path = crate::context_files::codex_home()?.join("auth.json");
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(err) => {
            tracing::warn!(error = %err, "codex auth.json unreadable; subscription unknown");
            return None;
        }
    };
    match parse_auth_file(&raw) {
        Ok(subscription) => Some(subscription),
        Err(reason) => {
            tracing::warn!(reason, "codex auth.json has no readable ChatGPT claims");
            None
        }
    }
}

pub(crate) fn parse_auth_file(raw: &str) -> Result<ChatgptSubscription, &'static str> {
    let file: AuthFile = serde_json::from_str(raw).map_err(|_| "auth.json is not valid JSON")?;
    let token = file
        .tokens
        .and_then(|t| t.id_token)
        .ok_or("auth.json has no id_token")?;
    let payload = token.split('.').nth(1).ok_or("id_token is not a JWT")?;
    let bytes = URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .map_err(|_| "id_token payload is not base64url")?;
    let mut claims: serde_json::Map<String, serde_json::Value> =
        serde_json::from_slice(&bytes).map_err(|_| "id_token payload is not JSON")?;
    let auth: AuthClaims = claims
        .remove(AUTH_CLAIMS)
        .and_then(|v| serde_json::from_value(v).ok())
        .ok_or("id_token has no ChatGPT auth claims")?;
    Ok(ChatgptSubscription {
        plan_type: auth.chatgpt_plan_type.filter(|p| !p.is_empty()),
        active_until: auth
            .chatgpt_subscription_active_until
            .as_deref()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&Utc)),
    })
}

#[cfg(test)]
#[path = "chatgpt_subscription_tests.rs"]
mod tests;
