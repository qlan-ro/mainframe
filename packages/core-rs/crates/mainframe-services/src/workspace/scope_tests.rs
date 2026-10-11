use super::*;
use mainframe_types::chat::NewChat;
use mainframe_types::chat_patch::ChatPatch;

#[tokio::test]
async fn resolves_stored_scope_then_checks_presence_without_runtime_flag() {
    let db = DatabaseManager::open(std::path::Path::new(":memory:")).unwrap();
    let root = tempfile::tempdir().unwrap();
    let project = db
        .projects
        .create(root.path().to_str().unwrap(), None)
        .unwrap();
    let chat = db
        .chats
        .create(&NewChat {
            project_id: project.id.clone(),
            adapter_id: "claude".into(),
            model: None,
            permission_mode: None,
            automation_run_id: None,
            temporary: false,
            scratch_root: None,
        })
        .unwrap();
    assert_eq!(
        resolve_scope(&db, &project.id, None).unwrap().path,
        project.path
    );
    assert!(matches!(
        resolve_scope(&db, &project.id, Some("unknown")),
        Err(ScopeError::ChatNotFound)
    ));
    let worktree = tempfile::tempdir().unwrap();
    std::fs::write(worktree.path().join(".git"), "gitdir: unused").unwrap();
    let path = worktree.path().to_string_lossy().into_owned();
    db.chats
        .update(
            &chat.id,
            &ChatPatch {
                worktree_path: Some(Some(path.clone())),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        resolve_scope(&db, &project.id, Some(&chat.id))
            .unwrap()
            .path,
        path
    );
    assert_eq!(
        db.chats.get(&chat.id).unwrap().unwrap().worktree_missing,
        None
    );
    worktree.close().unwrap();
    let stored = resolve_scope(&db, &project.id, Some(&chat.id)).unwrap();
    assert_eq!(stored.path, path);
    assert!(
        matches!(check_scope_presence(stored).await, Err(ScopeError::WorktreeMissing(scope)) if scope.path == path)
    );
    let other = db.projects.create("/other", None).unwrap();
    assert!(matches!(
        resolve_scope(&db, &other.id, Some(&chat.id)),
        Err(ScopeError::CrossProject)
    ));
    assert!(matches!(
        resolve_scope(&db, "missing", None),
        Err(ScopeError::ProjectNotFound)
    ));
}
