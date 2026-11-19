#[test]
fn atomic_settings_failure_rolls_back_every_key() {
    let db = crate::DatabaseManager::open(std::path::Path::new(":memory:")).unwrap();
    db.settings
        .set("general", "worktreeDir", "original")
        .unwrap();
    db.settings.db.execute_batch("CREATE TRIGGER reject_idle BEFORE INSERT ON settings WHEN NEW.key = 'idleCompaction.enabled' BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    let result = db.settings.transaction(|settings| {
        settings.set("general", "worktreeDir", "changed")?;
        settings.set("general", "idleCompaction.enabled", "true")
    });
    assert!(result.is_err());
    assert_eq!(
        db.settings
            .get("general", "worktreeDir")
            .unwrap()
            .as_deref(),
        Some("original")
    );
    assert_eq!(
        db.settings
            .get("general", "idleCompaction.enabled")
            .unwrap(),
        None
    );
}
#[test]
fn committed_toggle_survives_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.db");
    {
        let db = crate::DatabaseManager::open(&path).unwrap();
        db.settings
            .transaction(|s| s.set("general", "idleCompaction.enabled", "true"))
            .unwrap();
    }
    let db = crate::DatabaseManager::open(&path).unwrap();
    assert_eq!(
        db.settings
            .get("general", "idleCompaction.enabled")
            .unwrap()
            .as_deref(),
        Some("true")
    );
}
