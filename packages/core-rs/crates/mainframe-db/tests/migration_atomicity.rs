#![allow(clippy::unwrap_used, clippy::expect_used)]
use mainframe_db::{
    DbError,
    migrate::{Migration, run_versioned},
};
use rusqlite::Connection;

#[test]
fn failed_step_rolls_back_ddl_data_and_version_but_keeps_prior_steps() {
    let db = Connection::open_in_memory().unwrap();
    let migrations = [
        Migration {
            version: 1,
            up: |db| {
                db.execute_batch("CREATE TABLE kept(value INTEGER); INSERT INTO kept VALUES(7)")?;
                Ok(())
            },
        },
        Migration {
            version: 2,
            up: |db| {
                db.execute_batch("CREATE TABLE discarded(value INTEGER); UPDATE kept SET value=9")?;
                Err(DbError::Message("migration failed".into()))
            },
        },
    ];
    assert_eq!(
        run_versioned(&db, &migrations, 2).unwrap_err().to_string(),
        "migration failed"
    );
    assert_eq!(
        db.query_row("SELECT value FROM kept", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        7
    );
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert!(db.prepare("SELECT * FROM discarded").is_err());
}
