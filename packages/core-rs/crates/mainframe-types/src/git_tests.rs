use super::*;

#[test]
fn branch_info_omits_optionals() {
    let json = r#"{"name":"main","current":true}"#;
    let b: BranchInfo = serde_json::from_str(json).unwrap();
    assert!(b.current);
    assert_eq!(serde_json::to_string(&b).unwrap(), json);
}

#[test]
fn pull_result_success_tagged() {
    let json = r#"{"status":"success","summary":{"changes":3,"insertions":10,"deletions":2}}"#;
    let r: PullResult = serde_json::from_str(json).unwrap();
    matches!(r, PullResult::Success { .. });
    assert_eq!(serde_json::to_string(&r).unwrap(), json);
}

#[test]
fn pull_result_up_to_date_unit_variant() {
    let json = r#"{"status":"up-to-date"}"#;
    let r: PullResult = serde_json::from_str(json).unwrap();
    assert!(matches!(r, PullResult::UpToDate));
    assert_eq!(serde_json::to_string(&r).unwrap(), json);
}

#[test]
fn delete_branch_result_kebab_variants() {
    let json = r#"{"status":"not-merged","message":"branch not fully merged"}"#;
    let r: DeleteBranchResult = serde_json::from_str(json).unwrap();
    assert!(matches!(r, DeleteBranchResult::NotMerged { .. }));
    assert_eq!(serde_json::to_string(&r).unwrap(), json);
}

#[test]
fn fetch_result_single_variant_round_trips() {
    let json = r#"{"status":"success","remote":"origin"}"#;
    let r: FetchResult = serde_json::from_str(json).unwrap();
    assert_eq!(serde_json::to_string(&r).unwrap(), json);
}

#[test]
fn branch_update_status_kind_kebab() {
    assert_eq!(
        serde_json::to_string(&BranchUpdateStatusKind::UpToDate).unwrap(),
        "\"up-to-date\""
    );
}

#[test]
fn working_stat_round_trips() {
    let json = r#"{"files":[{"path":"a.rs","additions":5,"deletions":1}],"totalAdditions":5,"totalDeletions":1}"#;
    let s: WorkingStat = serde_json::from_str(json).unwrap();
    assert_eq!(s.total_additions, 5);
    assert_eq!(serde_json::to_string(&s).unwrap(), json);
}
