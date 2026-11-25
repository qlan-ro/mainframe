use super::*;
use mainframe_db::ClearedWorktreeBase;
use mainframe_git::git_exec::{GitTimeout, exec_git};
use mainframe_runtime::sync::KeyedMutex;
use mainframe_types::git::DeleteBranchResult;
use std::path::PathBuf;
use std::sync::OnceLock;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameBranchBody {
    old_name: String,
    new_name: String,
}
#[derive(Debug, Deserialize)]
struct DeleteBranchBody {
    name: String,
    force: Option<bool>,
    remote: Option<bool>,
}

pub(super) async fn rename_branch(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ChatIdQuery>,
    body: Bytes,
) -> Response {
    let (path, val) = match resolve(&ctx, &id, q.chat_id.as_deref(), &body).await {
        Ok(v) => v,
        Err(r) => return r.into_response(),
    };
    let data: RenameBranchBody = match body_of(val) {
        Ok(d) => d,
        Err(m) => return fail_with(&m),
    };
    if data.old_name.is_empty() || !is_valid_branch_name(&data.new_name) {
        return fail(StatusCode::BAD_REQUEST, "Invalid branch name");
    }
    let scope = RefScope::new(&path).await;
    let _guard = scope.lock().await;
    let bases = match scope
        .clear(&ctx, id, data.old_name.clone(), Some(data.new_name.clone()))
        .await
    {
        Ok(bases) => bases,
        Err(error) => return error.into_response(),
    };
    let result = ctx
        .core
        .git
        .for_project(path)
        .rename_branch(&data.old_name, &data.new_name)
        .await;
    if result.is_err() {
        restore_bases(&ctx, bases).await;
    }
    git_empty(result, "renameBranch")
}

pub(super) async fn delete_branch(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    Query(q): Query<ChatIdQuery>,
    body: Bytes,
) -> Response {
    let (path, val) = match resolve(&ctx, &id, q.chat_id.as_deref(), &body).await {
        Ok(v) => v,
        Err(r) => return r.into_response(),
    };
    let data: DeleteBranchBody = match body_of(val) {
        Ok(d) => d,
        Err(m) => return fail_with(&m),
    };
    if data.name.is_empty() {
        return fail(StatusCode::BAD_REQUEST, "name must not be empty");
    }
    let git = ctx.core.git.for_project(path.clone());
    let force = data.force.unwrap_or(false);
    if data.remote.unwrap_or(false) {
        return git_result(
            git.delete_branch(&data.name, force, true).await,
            "deleteBranch",
        );
    }

    let scope = RefScope::new(&path).await;
    let _guard = scope.lock().await;
    let bases = match scope.clear(&ctx, id, data.name.clone(), None).await {
        Ok(bases) => bases,
        Err(error) => return error.into_response(),
    };
    let result = git.delete_branch(&data.name, force, false).await;
    if !matches!(result, Ok(DeleteBranchResult::Success)) {
        restore_bases(&ctx, bases).await;
    }
    git_result(result, "deleteBranch")
}

struct RefScope {
    key: String,
    common_dir: Option<PathBuf>,
}

impl RefScope {
    async fn new(path: &str) -> Self {
        let common_dir = git_common_dir(path).await;
        let key = common_dir
            .as_ref()
            .map_or_else(|| path.to_owned(), |dir| dir.to_string_lossy().into_owned());
        Self { key, common_dir }
    }

    async fn lock(&self) -> tokio::sync::OwnedMutexGuard<()> {
        static LOCKS: OnceLock<KeyedMutex> = OnceLock::new();
        LOCKS
            .get_or_init(KeyedMutex::default)
            .acquire(&self.key)
            .await
    }

    async fn clear(
        &self,
        ctx: &AppCtx,
        project: String,
        branch: String,
        other: Option<String>,
    ) -> Result<Vec<ClearedWorktreeBase>, crate::respond::ApiError> {
        let (candidate_branch, candidate_other) = (branch.clone(), other.clone());
        let candidates = ctx
            .core
            .db
            .call(move |db| {
                db.chats
                    .projects_with_worktree_bases(&candidate_branch, candidate_other.as_deref())
            })
            .await?;
        let mut projects = vec![project];
        for (id, path) in candidates {
            if id != projects[0]
                && self.common_dir.is_some()
                && git_common_dir(&path).await == self.common_dir
            {
                projects.push(id);
            }
        }
        let bases = ctx
            .core
            .db
            .call(move |db| {
                db.chats
                    .clear_worktree_bases_for_branches(&projects, &branch, other.as_deref())
            })
            .await?;
        for base in &bases {
            ctx.chat
                .chat_manager
                .apply_worktree_base_change(base, false);
        }
        Ok(bases)
    }
}

async fn git_common_dir(path: &str) -> Option<PathBuf> {
    let common = exec_git(
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        path,
        GitTimeout::Default,
    )
    .await
    .ok()?;
    tokio::fs::canonicalize(common.trim_end_matches('\n'))
        .await
        .ok()
}

async fn restore_bases(ctx: &AppCtx, bases: Vec<ClearedWorktreeBase>) {
    if bases.is_empty() {
        return;
    }
    match ctx
        .core
        .db
        .call(move |db| db.chats.restore_worktree_bases(bases))
        .await
    {
        Ok(restored) => {
            for base in &restored {
                ctx.chat.chat_manager.apply_worktree_base_change(base, true);
            }
        }
        Err(error) => {
            tracing::warn!(%error, "failed to restore worktree bases after a rejected git operation")
        }
    }
}

#[cfg(test)]
mod tests;
