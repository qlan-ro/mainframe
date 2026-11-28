use mainframe_types::settings::{HistoryReleaseConfig, IdleCompactionConfig};
use serde::{Deserialize, Deserializer};

pub(super) fn deserialize_patch<'de, D: Deserializer<'de>>(
    d: D,
) -> Result<Option<IdleCompactionConfig>, D::Error> {
    IdleCompactionConfig::deserialize(d).map(Some)
}

/// `historyRelease` must carry `idleMinutes`: whole minutes, or `null` for
/// never. A missing key is rejected rather than read as never; the range is
/// checked with the rest of the patch (`general_patch_error`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoryReleasePatch {
    #[serde(deserialize_with = "required_minutes")]
    idle_minutes: Option<u32>,
}

fn required_minutes<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u32>, D::Error> {
    Option::<u32>::deserialize(d)
}

pub(super) fn deserialize_history_release<'de, D: Deserializer<'de>>(
    d: D,
) -> Result<Option<HistoryReleaseConfig>, D::Error> {
    HistoryReleasePatch::deserialize(d).map(|patch| {
        Some(HistoryReleaseConfig {
            idle_minutes: patch.idle_minutes,
        })
    })
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
    fn history_release_defaults_to_ten_minutes_and_stores_only_a_change() {
        let db = mainframe_db::DatabaseManager::open(std::path::Path::new(":memory:")).unwrap();
        let read = |db: &mainframe_db::DatabaseManager| {
            general_body(db.settings.get_by_category(GENERAL).unwrap()).unwrap()["historyRelease"]
                .clone()
        };
        assert_eq!(read(&db), json!({"idleMinutes": 10}));

        for (patch, stored, body) in [
            (
                json!({"idleMinutes": 30}),
                Some("30"),
                json!({"idleMinutes": 30}),
            ),
            (
                json!({"idleMinutes": null}),
                Some("never"),
                json!({"idleMinutes": null}),
            ),
            (json!({"idleMinutes": 10}), None, json!({"idleMinutes": 10})),
        ] {
            let patch = serde_json::from_value(json!({"historyRelease": patch})).unwrap();
            write_general_and_refresh(&db.settings, patch, |_| {}).unwrap();
            assert_eq!(
                db.settings
                    .get(GENERAL, "historyRelease.idleMinutes")
                    .unwrap()
                    .as_deref(),
                stored
            );
            assert_eq!(read(&db), body);
        }
    }

    #[test]
    fn a_history_release_outside_its_bounds_is_rejected() {
        for value in [
            json!({}),
            json!({"idleMinutes": "10"}),
            json!({"idleMinutes": -1}),
            json!({"idleMinutes": 5, "x": 1}),
            json!(null),
        ] {
            assert!(
                serde_json::from_value::<GeneralPatch>(json!({"historyRelease": value})).is_err(),
                "{value}"
            );
        }
        for minutes in [0, 1441] {
            let patch: GeneralPatch =
                serde_json::from_value(json!({"historyRelease": {"idleMinutes": minutes}}))
                    .unwrap();
            assert!(general_patch_error(&patch).is_some(), "{minutes}");
        }
        let patch: GeneralPatch =
            serde_json::from_value(json!({"historyRelease": {"idleMinutes": 5}})).unwrap();
        assert!(general_patch_error(&patch).is_none());
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
