#[test]
fn produces_byte_identical_final_schema_fresh_vs_migrated() {
    let fresh = Connection::open_in_memory().unwrap();
    initialize_schema(&fresh).unwrap();

    let migrated = build_legacy_intermediate();
    initialize_schema(&migrated).unwrap();

    assert_eq!(schema_sql(&migrated), schema_sql(&fresh));
    assert_eq!(user_version(&migrated), user_version(&fresh));
}

#[test]
fn migration_36_leaves_existing_worktree_base_unknown() {
    let db = Connection::open_in_memory().unwrap();
    run_migrations(&db, 35).unwrap();
    db.execute(
        "INSERT INTO projects (id, name, path, created_at, last_opened_at) VALUES ('p', 'Project', '/repo', 'now', 'now')",
        [],
    ).unwrap();
    db.execute(
        "INSERT INTO chats (id, adapter_id, project_id, created_at, updated_at, worktree_path, branch_name)
         VALUES ('c', 'claude', 'p', 'now', 'now', '/wt/x', 'feature/x')",
        [],
    ).unwrap();
    run_migrations(&db, 36).unwrap();
    let row: (String, String, Option<String>) = db
        .query_row(
            "SELECT worktree_path, branch_name, base_branch FROM chats WHERE id = 'c'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(row, ("/wt/x".to_string(), "feature/x".to_string(), None));
}
