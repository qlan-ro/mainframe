//! Quota keys combine adapter and account identity.
//! A transient identity read failure keeps the previous account key.

/// Synthetic `accountIdentity` used for keyless auth (API key, Bedrock) — carries
/// no quota.
pub const UNKNOWN_ACCOUNT_IDENTITY: &str = "identity:unknown";

/// Compound key (#259): a same-provider account swap naturally lands on a fresh,
/// empty key.
#[must_use]
pub(crate) fn compute_quota_key(adapter_id: &str, account_identity: Option<&str>) -> String {
    format!(
        "{adapter_id}:{}",
        account_identity.unwrap_or(UNKNOWN_ACCOUNT_IDENTITY)
    )
}

/// A transient identity-read failure (`fresh_identity == None`) reuses the
/// caller's last-known identity so a healthy gauge doesn't flicker to unknown on
/// a momentary file lock.
#[must_use]
pub(crate) fn resolve_account_identity(
    fresh_identity: Option<&str>,
    last_known_identity: Option<&str>,
) -> Option<String> {
    fresh_identity.or(last_known_identity).map(str::to_string)
}

#[cfg(test)]
#[path = "keying_tests.rs"]
mod tests;
