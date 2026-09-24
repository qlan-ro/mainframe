//! `POST /api/chats` — split out of `chat_commands.rs` for rule 2's create
//! validator (#346): a chat now carries either a project or the `noProject`
//! flag, and an optional `temporary` flag fixed at creation.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::post;
use serde::Deserialize;

use mainframe_types::chat::{NO_PROJECT_ID, NewChat};

use crate::ctx::AppCtx;
use crate::respond::{fail, ok};
use crate::routes::projects::parse_body;

#[derive(Deserialize)]
struct CreateChatBody {
    #[serde(rename = "projectId")]
    project_id: Option<String>,
    #[serde(rename = "noProject")]
    no_project: Option<bool>,
    #[serde(rename = "adapterId")]
    adapter_id: Option<String>,
    model: Option<String>,
    #[serde(rename = "permissionMode")]
    permission_mode: Option<String>,
    #[serde(rename = "worktreePath")]
    worktree_path: Option<String>,
    #[serde(rename = "branchName")]
    branch_name: Option<String>,
    temporary: Option<bool>,
}

/// Rule 2's shape checks: adapterId required, exactly one of a non-empty
/// projectId or `noProject: true`, worktree fields paired, and never a
/// worktree on a non-project chat. Returns `(adapter_id, no_project,
/// project_id)` on success.
fn validate_shape(b: &CreateChatBody) -> Result<(String, bool, Option<String>), Response> {
    let Some(adapter_id) = b.adapter_id.clone().filter(|s| !s.is_empty()) else {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "projectId and adapterId are required",
        ));
    };
    let no_project = b.no_project.unwrap_or(false);
    let project_id = b.project_id.clone().filter(|s| !s.is_empty());
    // Exactly one of a non-empty projectId or noProject: true.
    if no_project == project_id.is_some() {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "projectId and adapterId are required",
        ));
    }
    if b.worktree_path.is_none() != b.branch_name.is_none() {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "worktreePath and branchName must be provided together",
        ));
    }
    if no_project && (b.worktree_path.is_some() || b.branch_name.is_some()) {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "a non-project chat cannot have a worktree",
        ));
    }
    Ok((adapter_id, no_project, project_id))
}

/// Resolves to the hidden scratch id for a non-project chat, else the real
/// project's id after confirming it exists (an unknown or scratch id 400s,
/// since `projects.get` excludes the hidden row — rule 1).
async fn resolve_project_id(
    ctx: &Arc<AppCtx>,
    no_project: bool,
    project_id: Option<String>,
) -> Result<String, Response> {
    if no_project {
        return Ok(NO_PROJECT_ID.to_string());
    }
    // `validate_shape` proved exactly one of `no_project`/`project_id` holds,
    // so reaching here means `project_id` is `Some`.
    let Some(pid) = project_id else {
        return Ok(NO_PROJECT_ID.to_string());
    };
    match ctx.db.call(move |db| db.projects.get(&pid)).await {
        Ok(Some(project)) => Ok(project.id),
        Ok(None) => Err(fail(StatusCode::BAD_REQUEST, "Project not found")),
        Err(err) => Err(crate::async_err::internal_error("get project", &err)),
    }
}

async fn create(State(ctx): State<Arc<AppCtx>>, body: Bytes) -> Response {
    let Some(b) = parse_body::<CreateChatBody>(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    let (adapter_id, no_project, project_id) = match validate_shape(&b) {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let resolved_project_id = match resolve_project_id(&ctx, no_project, project_id).await {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(
            project_id = %resolved_project_id,
            %adapter_id,
            "createChat is a Phase-4 seam (ChatManager unavailable)"
        );
        return fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "createChatWithDefaults unavailable",
        );
    };
    let chat = cm
        .create_chat_with_defaults(
            NewChat {
                project_id: resolved_project_id,
                adapter_id,
                model: b.model,
                permission_mode: b.permission_mode,
                automation_run_id: None,
                temporary: b.temporary.unwrap_or(false),
                scratch_root: None,
            },
            b.worktree_path.as_deref(),
            b.branch_name.as_deref(),
        )
        .await;
    ok(chat)
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/api/chats", post(create))
}

#[cfg(test)]
mod tests {
    use axum::body::to_bytes;

    use super::*;

    async fn read(resp: Response) -> (StatusCode, serde_json::Value) {
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        )
    }

    #[tokio::test]
    async fn create_rejects_missing_fields_400() {
        let ctx = AppCtx::test_ctx();
        let resp = create(
            State(ctx.clone()),
            axum::body::Bytes::from(r#"{"projectId":"p"}"#),
        )
        .await;
        assert_eq!(read(resp).await.0, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn create_rejects_worktree_without_branch_400() {
        let ctx = AppCtx::test_ctx();
        let resp = create(
            State(ctx.clone()),
            axum::body::Bytes::from(
                r#"{"projectId":"p","adapterId":"claude","worktreePath":"/wt"}"#,
            ),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(
            body["error"],
            "worktreePath and branchName must be provided together"
        );
    }

    #[tokio::test]
    async fn create_rejects_an_unknown_project_id_400_and_writes_no_row() {
        let ctx = AppCtx::test_ctx();
        let resp = create(
            State(ctx.clone()),
            axum::body::Bytes::from(r#"{"projectId":"nope","adapterId":"claude"}"#),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "Project not found");
    }

    #[tokio::test]
    async fn create_rejects_the_scratch_project_id_as_an_unknown_project_400() {
        let ctx = AppCtx::test_ctx();
        let resp = create(
            State(ctx.clone()),
            axum::body::Bytes::from(r#"{"projectId":"mainframe-no-project","adapterId":"claude"}"#),
        )
        .await;
        assert_eq!(read(resp).await.0, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn create_rejects_no_project_together_with_a_project_id_400() {
        let ctx = AppCtx::test_ctx();
        let resp = create(
            State(ctx.clone()),
            axum::body::Bytes::from(r#"{"projectId":"p","noProject":true,"adapterId":"claude"}"#),
        )
        .await;
        assert_eq!(read(resp).await.0, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn create_rejects_no_project_with_a_worktree_400() {
        let ctx = AppCtx::test_ctx();
        let resp = create(
            State(ctx.clone()),
            axum::body::Bytes::from(
                r#"{"noProject":true,"adapterId":"claude","worktreePath":"/wt","branchName":"b"}"#,
            ),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "a non-project chat cannot have a worktree");
    }

    #[tokio::test]
    async fn create_rejects_neither_project_nor_no_project_400() {
        let ctx = AppCtx::test_ctx();
        let resp = create(
            State(ctx.clone()),
            axum::body::Bytes::from(r#"{"adapterId":"claude"}"#),
        )
        .await;
        assert_eq!(read(resp).await.0, StatusCode::BAD_REQUEST);
    }
}

// PORT STATUS: split out of src/server/routes/chat-commands.ts's `create`
// confidence: high
// todos: 0
// notes: rule 2's create validator (#346) — exactly one of a non-empty
// projectId or noProject: true, adapterId required, no worktree on a
// non-project chat, and the project must exist (the hidden scratch row is
// excluded from `projects.get`, so passing it as `projectId` 400s like any
// other unknown id).
