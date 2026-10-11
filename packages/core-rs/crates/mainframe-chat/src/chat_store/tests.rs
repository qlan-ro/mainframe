use super::*;
use crate::context_tracker::ContextDb;

#[test]
fn database_failures_do_not_become_missing_chats_empty_lists_or_stub_creates() {
    let db = Db::spawn(|| DatabaseManager::open(std::path::Path::new(":memory:"))).unwrap();
    let project = db
        .call_blocking(|d| d.projects.create("/project", None))
        .unwrap();
    db.call_blocking(|d| {
        d.connection().execute_batch("DROP TABLE chats")?;
        Ok(())
    })
    .unwrap();
    assert!(db.chats_get("missing").is_err());
    assert!(db.chats_list(&project.id).is_err());
    assert!(db.chats_list_all().is_err());
    assert!(
        db.chats_list_filtered(None, None, false, true, true)
            .is_err()
    );
    assert!(
        db.chats_create(&NewChat {
            project_id: project.id,
            adapter_id: "claude".into(),
            ..Default::default()
        })
        .is_err()
    );
    assert!(
        db.chats_update(
            "missing",
            &ChatPatch {
                title: Some("changed".into()),
                ..Default::default()
            }
        )
        .is_err()
    );
    assert!(db.add_plan_file("missing", "/plan.md").is_err());
    assert!(db.get_pending_fork("missing").is_err());
    assert!(ContextDb::get_mentions(&db, "missing").is_err());
}

#[test]
fn successful_absence_is_distinct_from_a_database_failure() {
    let db = Db::spawn(|| DatabaseManager::open(std::path::Path::new(":memory:"))).unwrap();
    assert!(db.chats_get("missing").unwrap().is_none());
    assert!(db.chats_list("missing").unwrap().is_empty());
    assert!(db.get_pending_fork("missing").unwrap().is_none());
}

#[tokio::test]
async fn failed_create_does_not_register_or_announce_a_chat() {
    use crate::chat_manager::ChatManager;
    use crate::test_support::FakeDeps;
    let deps = FakeDeps::arc();
    *deps.store.write_failure.lock().unwrap() = Some("database unavailable".into());
    let manager = ChatManager::new(deps.clone());
    assert!(manager.create_chat(NewChat::default()).await.is_err());
    assert!(deps.events().is_empty());
    assert!(manager.get_chat("new").is_none());
}

#[test]
fn failed_update_returns_an_error_without_a_success_event() {
    use crate::chat_manager::ChatShared;
    use crate::test_support::{FakeDeps, test_chat};
    let deps = FakeDeps::arc();
    *deps.store.write_failure.lock().unwrap() = Some("database unavailable".into());
    let shared = ChatShared::new(deps.clone());
    assert!(
        shared
            .update_and_emit(test_chat("c1"), &ChatPatch::default())
            .is_err()
    );
    assert!(deps.events().is_empty());
}
