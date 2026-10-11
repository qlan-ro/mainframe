use mainframe_db::{DatabaseManager, DbError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopePath {
    pub path: String,
    pub project_path: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ScopeError {
    #[error("Project not found")]
    ProjectNotFound,
    #[error("Chat not found")]
    ChatNotFound,
    #[error("Project not found")]
    CrossProject,
    #[error("Worktree missing")]
    WorktreeMissing(ScopePath),
    #[error(transparent)]
    Database(#[from] DbError),
}

pub fn resolve_scope(
    db: &DatabaseManager,
    project_id: &str,
    chat_id: Option<&str>,
) -> Result<ScopePath, ScopeError> {
    let project = db
        .projects
        .get(project_id)?
        .ok_or(ScopeError::ProjectNotFound)?;
    let chat = match chat_id {
        Some(id) => Some(db.chats.get(id)?.ok_or(ScopeError::ChatNotFound)?),
        None => None,
    };
    if let Some(chat) = chat {
        if chat.project_id != project_id {
            return Err(ScopeError::CrossProject);
        }
        if let Some(path) = chat.worktree_path.filter(|path| !path.is_empty()) {
            return Ok(ScopePath {
                path,
                project_path: project.path,
            });
        }
    }
    Ok(ScopePath {
        path: project.path.clone(),
        project_path: project.path,
    })
}

pub async fn check_scope_presence(scope: ScopePath) -> Result<ScopePath, ScopeError> {
    if scope.path != scope.project_path
        && tokio::fs::metadata(std::path::Path::new(&scope.path).join(".git"))
            .await
            .is_err()
    {
        return Err(ScopeError::WorktreeMissing(scope));
    }
    Ok(scope)
}

#[cfg(test)]
mod tests {
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
}
