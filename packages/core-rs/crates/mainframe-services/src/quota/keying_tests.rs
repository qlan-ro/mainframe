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
