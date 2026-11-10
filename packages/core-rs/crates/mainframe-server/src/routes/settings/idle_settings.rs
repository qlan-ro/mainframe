use mainframe_types::settings::IdleCompactionConfig;
use serde::{Deserialize, Deserializer};

pub(super) fn deserialize_patch<'de, D: Deserializer<'de>>(
    d: D,
) -> Result<Option<IdleCompactionConfig>, D::Error> {
    IdleCompactionConfig::deserialize(d).map(Some)
}

#[cfg(test)]
mod tests {
    use super::super::*;
    #[test]
    fn idle_defaults_are_typed_and_partial_patch_preserves_rows() {
        let db = mainframe_db::DatabaseManager::open(std::path::Path::new(":memory:")).unwrap();
        assert_eq!(
            general_body(HashMap::new()).unwrap()["idleCompaction"]["enabled"],
            false
        );
        let patch = serde_json::from_value(json!({"idleCompaction":{"enabled":true}})).unwrap();
        write_general_and_refresh(&db.settings, patch, |_| {}).unwrap();
        let patch = serde_json::from_value(json!({"worktreeDir":"custom"})).unwrap();
        write_general_and_refresh(&db.settings, patch, |_| {}).unwrap();
        let body = general_body(db.settings.get_by_category(GENERAL).unwrap()).unwrap();
        assert_eq!(body["idleCompaction"]["enabled"], true);
        assert_eq!(body["worktreeDir"], "custom");
    }
    #[test]
    fn invalid_nested_patch_is_rejected_before_writes() {
        for value in [json!(null), json!("true"), json!(1), json!([]), json!({})] {
            assert!(
                serde_json::from_value::<GeneralPatch>(
                    json!({"worktreeDir":"other", "idleCompaction":{"enabled":value}})
                )
                .is_err()
            );
        }
        assert!(serde_json::from_value::<GeneralPatch>(json!({"idleCompaction":null})).is_err());
    }
}
