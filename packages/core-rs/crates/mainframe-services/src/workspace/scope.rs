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
#[path = "scope_tests.rs"]
mod tests;
