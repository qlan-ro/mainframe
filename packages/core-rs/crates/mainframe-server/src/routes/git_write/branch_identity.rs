use super::*;
use mainframe_git::git_exec::{GitTimeout, exec_git};
use mainframe_git::parse_worktree_list;
use mainframe_types::git::DeleteBranchResult;
use std::path::PathBuf;

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
    if let Err(error) = clear_bases(
        &ctx,
        &path,
        id,
        data.old_name.clone(),
        Some(data.new_name.clone()),
    )
    .await
    {
        return error.into_response();
    }
    let result = ctx
        .core
        .git
        .for_project(path)
        .rename_branch(&data.old_name, &data.new_name)
        .await;
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

    if branch_is_checked_out(&path, &data.name).await {
        return git_result(
            Ok(DeleteBranchResult::IsCurrent {
                message: "Cannot delete the currently checked-out branch".to_owned(),
            }),
            "deleteBranch",
        );
    }
    if let Err(error) = clear_bases(&ctx, &path, id, data.name.clone(), None).await {
        return error.into_response();
    }
    git_result(
        git.delete_branch(&data.name, force, false).await,
        "deleteBranch",
    )
}

async fn branch_is_checked_out(path: &str, branch: &str) -> bool {
    let Ok(listing) = exec_git(
        &["worktree", "list", "--porcelain"],
        path,
        GitTimeout::Default,
    )
    .await
    else {
        return false;
    };
    let reference = format!("refs/heads/{branch}");
    parse_worktree_list(&listing)
        .iter()
        .any(|entry| entry.branch.as_deref() == Some(reference.as_str()))
}

async fn clear_bases(
    ctx: &AppCtx,
    path: &str,
    project: String,
    branch: String,
    other: Option<String>,
) -> Result<(), crate::respond::ApiError> {
    let projects = match git_common_dir(path).await {
        Some(common_dir) => {
            Some(matching_projects(ctx, project, &branch, other.as_deref(), &common_dir).await?)
        }
        None => None,
    };
    let bases = ctx
        .core
        .db
        .call(move |db| {
            db.chats.clear_worktree_bases_for_branches(
                projects.as_deref(),
                &branch,
                other.as_deref(),
            )
        })
        .await?;
    for base in &bases {
        ctx.chat.chat_manager.apply_cleared_worktree_base(base);
    }
    Ok(())
}

async fn matching_projects(
    ctx: &AppCtx,
    project: String,
    branch: &str,
    other: Option<&str>,
    common_dir: &std::path::Path,
) -> Result<Vec<String>, crate::respond::ApiError> {
    let (branch, other) = (branch.to_owned(), other.map(str::to_owned));
    let candidates = ctx
        .core
        .db
        .call(move |db| {
            db.chats
                .projects_with_worktree_bases(&branch, other.as_deref())
        })
        .await?;
    let mut projects = vec![project];
    for (id, path) in candidates {
        if id != projects[0]
            && git_common_dir(&path)
                .await
                .is_none_or(|dir| dir == common_dir)
        {
            projects.push(id);
        }
    }
    Ok(projects)
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

#[cfg(test)]
mod tests;
