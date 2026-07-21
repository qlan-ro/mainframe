//! Ported from `src/quota/keying.ts` — compound `(adapterId, accountIdentity)`
//! keying and transient-read-failure identity resolution.

/// Synthetic `accountIdentity` used for keyless auth (API key, Bedrock) — carries
/// no quota.
pub const UNKNOWN_ACCOUNT_IDENTITY: &str = "identity:unknown";

/// Compound key (#259): a same-provider account swap naturally lands on a fresh,
/// empty key.
#[must_use]
pub fn compute_quota_key(adapter_id: &str, account_identity: Option<&str>) -> String {
    format!(
        "{adapter_id}:{}",
        account_identity.unwrap_or(UNKNOWN_ACCOUNT_IDENTITY)
    )
}

/// A transient identity-read failure (`fresh_identity == None`) reuses the
/// caller's last-known identity so a healthy gauge doesn't flicker to unknown on
/// a momentary file lock.
#[must_use]
pub fn resolve_account_identity(
    fresh_identity: Option<&str>,
    last_known_identity: Option<&str>,
) -> Option<String> {
    fresh_identity.or(last_known_identity).map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn combines_adapter_id_and_account_identity() {
        assert_eq!(compute_quota_key("claude", Some("user-a")), "claude:user-a");
    }

    #[test]
    fn falls_back_to_synthetic_unknown_bucket_when_keyless() {
        assert_eq!(
            compute_quota_key("codex", None),
            format!("codex:{UNKNOWN_ACCOUNT_IDENTITY}")
        );
    }

    #[test]
    fn produces_different_key_on_account_swap_under_same_adapter() {
        assert_ne!(
            compute_quota_key("claude", Some("user-a")),
            compute_quota_key("claude", Some("user-b"))
        );
    }

    #[test]
    fn keeps_keyless_buckets_distinct_per_adapter() {
        assert_ne!(
            compute_quota_key("claude", None),
            compute_quota_key("codex", None)
        );
    }

    #[test]
    fn reuses_last_known_identity_on_transient_read_failure() {
        assert_eq!(
            resolve_account_identity(None, Some("user-a")),
            Some("user-a".into())
        );
    }

    #[test]
    fn adopts_freshly_read_identity_over_last_known() {
        assert_eq!(
            resolve_account_identity(Some("user-b"), Some("user-a")),
            Some("user-b".into())
        );
    }

    #[test]
    fn stays_none_without_fresh_read_or_last_known() {
        assert_eq!(resolve_account_identity(None, None), None);
    }
}
