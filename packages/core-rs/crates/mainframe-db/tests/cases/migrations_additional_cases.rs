#[test]
fn produces_byte_identical_final_schema_fresh_vs_migrated() {
    let fresh = Connection::open_in_memory().unwrap();
    initialize_schema(&fresh).unwrap();

    let migrated = build_legacy_intermediate();
    initialize_schema(&migrated).unwrap();

    assert_eq!(schema_sql(&migrated), schema_sql(&fresh));
    assert_eq!(user_version(&migrated), user_version(&fresh));
}
