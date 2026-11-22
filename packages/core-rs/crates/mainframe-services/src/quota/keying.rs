//! Quota keys combine adapter and account identity.

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

#[cfg(test)]
#[path = "keying_tests.rs"]
mod tests;
