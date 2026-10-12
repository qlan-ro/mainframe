use super::*;
use std::path::Path;

fn open() -> SqliteActor<DatabaseManager> {
    SqliteActor::spawn(|| DatabaseManager::open(Path::new(":memory:"))).unwrap()
}

#[tokio::test]
async fn reads_and_writes_rows_through_the_actor() {
    let db = open();
    let kv: &dyn SettingsKv = &db;
    kv.set("provider", "claude.defaultModel", "opus")
        .await
        .unwrap();
    kv.set("provider", "claude.defaultModel", "sonnet")
        .await
        .unwrap();
    kv.set("provider", "codex.defaultMode", "yolo")
        .await
        .unwrap();
    kv.set("general", "worktreeDir", "trees").await.unwrap();

    assert_eq!(
        kv.get("provider", "claude.defaultModel").await.unwrap(),
        Some("sonnet".to_string())
    );
    assert_eq!(
        kv.get("general", "claude.defaultModel").await.unwrap(),
        None
    );
    assert_eq!(
        kv.get_by_category("provider").await.unwrap(),
        HashMap::from([
            ("claude.defaultModel".to_string(), "sonnet".to_string()),
            ("codex.defaultMode".to_string(), "yolo".to_string()),
        ])
    );

    kv.delete("provider", "claude.defaultModel").await.unwrap();
    kv.delete("provider", "never-stored").await.unwrap();
    assert_eq!(
        kv.get("provider", "claude.defaultModel").await.unwrap(),
        None
    );
}

#[tokio::test]
async fn a_database_failure_is_an_error_not_an_absent_row() {
    let db = open();
    db.call(|d| Ok(d.connection().execute_batch("DROP TABLE settings")?))
        .await
        .unwrap();
    let kv: &dyn SettingsKv = &db;

    let SettingsError::Store(read) = kv.get("general", "worktreeDir").await.unwrap_err();
    assert_eq!(read, "no such table: settings");
    assert!(kv.get_by_category("general").await.is_err());
    assert!(kv.set("general", "worktreeDir", "x").await.is_err());
    assert!(kv.delete("general", "worktreeDir").await.is_err());
}
