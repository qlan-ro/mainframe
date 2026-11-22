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
