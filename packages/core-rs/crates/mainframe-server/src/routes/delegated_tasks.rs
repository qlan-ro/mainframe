use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::post;
use mainframe_orchestration::input::check_id;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok_empty};

async fn cancel(
    State(ctx): State<Arc<AppCtx>>,
    Path((chat_id, task_id)): Path<(String, String)>,
) -> Response {
    if check_id("chatId", &chat_id).is_err() || check_id("taskId", &task_id).is_err() {
        return fail(StatusCode::BAD_REQUEST, "Invalid id");
    }
    if ctx
        .chat
        .orchestration
        .cancel_task_for_parent(&chat_id, &task_id)
        .await
    {
        ok_empty()
    } else {
        fail(StatusCode::NOT_FOUND, "Task not found for this chat")
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route(
        "/api/chats/{chatId}/delegated-tasks/{taskId}/cancel",
        post(cancel),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancel_rejects_invalid_and_unowned_ids() {
        let ctx = AppCtx::test_ctx();
        let invalid = cancel(
            State(Arc::clone(&ctx)),
            Path(("../chat".into(), "task".into())),
        )
        .await;
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
        let missing = cancel(State(ctx), Path(("chat".into(), "task".into()))).await;
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    }
}
