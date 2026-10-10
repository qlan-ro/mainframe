#![allow(clippy::unwrap_used, clippy::expect_used)]
use mainframe_db::DatabaseManager;
use mainframe_types::chat::NewChat;

#[test]
fn failed_readback_rolls_back_chat_and_seed_rows() {
    let db = DatabaseManager::open(std::path::Path::new(":memory:")).unwrap();
    let project = db.projects.create("/atomic", None).unwrap();
    db.connection().execute_batch("CREATE TRIGGER corrupt_readback AFTER INSERT ON chat_segments BEGIN UPDATE chats SET total_cost='invalid' WHERE id=NEW.chat_id; END;").unwrap();
    assert!(
        db.chats
            .create(&NewChat {
                project_id: project.id,
                adapter_id: "claude".into(),
                ..Default::default()
            })
            .is_err()
    );
    for table in ["chats", "chat_segments", "chat_native_sessions"] {
        let count: i64 = db
            .connection()
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0, "{table}");
    }
}

#[test]
fn failed_seed_rolls_back_chat_insert() {
    let db = DatabaseManager::open(std::path::Path::new(":memory:")).unwrap();
    let project = db.projects.create("/atomic", None).unwrap();
    db.connection().execute_batch("CREATE TRIGGER reject_seed BEFORE INSERT ON chat_segments BEGIN SELECT RAISE(ABORT, 'seed rejected'); END;").unwrap();
    assert!(
        db.chats
            .create(&NewChat {
                project_id: project.id,
                adapter_id: "claude".into(),
                ..Default::default()
            })
            .is_err()
    );
    let count: i64 = db
        .connection()
        .query_row("SELECT COUNT(*) FROM chats", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn failed_fork_readback_rolls_back_fork_and_preserves_parent() {
    let db = DatabaseManager::open(std::path::Path::new(":memory:")).unwrap();
    let project = db.projects.create("/fork-atomic", None).unwrap();
    let parent = db
        .chats
        .create(&NewChat {
            project_id: project.id.clone(),
            adapter_id: "claude".into(),
            ..Default::default()
        })
        .unwrap();
    db.connection().execute_batch("CREATE TRIGGER corrupt_fork AFTER INSERT ON chat_segments BEGIN UPDATE chats SET total_cost='invalid' WHERE id=NEW.chat_id; END;").unwrap();
    let pending = mainframe_db::PendingFork {
        fork_source: mainframe_types::adapter::ForkSource {
            source_session_id: "parent".into(),
            resume_path: None,
            last_turn_id: None,
        },
        snapshot_dir: "/tmp/fork".into(),
        provisional_title: "Fork".into(),
    };
    let result = db.chats.create_fork(&mainframe_db::ForkInsert {
        parent_chat_id: &parent.id,
        project_id: &project.id,
        adapter_id: "claude",
        model: None,
        permission_mode: None,
        plan_mode: false,
        effort: None,
        fast: None,
        ultracode: None,
        adaptive_thinking: None,
        worktree_path: None,
        branch_name: None,
        title: None,
        pending_fork: &pending,
        segments: None,
    });
    assert!(result.is_err());
    assert_eq!(db.chats.get(&parent.id).unwrap().unwrap(), parent);
    for table in ["chats", "chat_segments", "chat_native_sessions"] {
        let count: i64 = db
            .connection()
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1, "{table}");
    }
}
