use super::*;
use mainframe_types::git::DeleteBranchResult;

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
    let result = ctx
        .core
        .git
        .for_project(path)
        .rename_branch(&data.old_name, &data.new_name)
        .await;
    if result.is_ok()
        && let Err(error) = clear_bases(&ctx, id, data.old_name, Some(data.new_name)).await
    {
        return error.into_response();
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
    let result = ctx
        .core
        .git
        .for_project(path)
        .delete_branch(
            &data.name,
            data.force.unwrap_or(false),
            data.remote.unwrap_or(false),
        )
        .await;
    if matches!(result, Ok(DeleteBranchResult::Success))
        && let Err(error) = clear_bases(&ctx, id, data.name, None).await
    {
        return error.into_response();
    }
    git_result(result, "deleteBranch")
}

async fn clear_bases(
    ctx: &AppCtx,
    project: String,
    branch: String,
    other: Option<String>,
) -> Result<(), crate::respond::ApiError> {
    let changed = ctx
        .core
        .db
        .call(move |db| {
            db.chats
                .clear_worktree_bases_for_branches(&project, &branch, other.as_deref())
        })
        .await?;
    for id in changed {
        ctx.chat.chat_manager.refresh_worktree_base(&id);
    }
    Ok(())
}

#[cfg(test)]
mod tests;
