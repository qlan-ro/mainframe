//! `POST /api/chats/{id}/discard` (#346 rule 5), and the temporary-chat
//! refusal shared by the pin/tag/archive/unarchive guards (rule 4).

use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::post;

use mainframe_types::chat::Chat;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok_empty};

/// Rule 4: pin, tags, archive and unarchive all refuse a temporary chat with
/// the same `fail` (409) envelope and leave it unchanged. `action` names the
/// refused verb for the message (e.g. "pin", "archive").
pub(crate) fn refuse_if_temporary(chat: &Chat, action: &str) -> Option<Response> {
    chat.temporary.then(|| {
        fail(
            StatusCode::CONFLICT,
            format!("cannot {action} a temporary chat"),
        )
    })
}

async fn discard(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    let lookup = id.clone();
    let chat = match ctx.db.call(move |db| db.chats.get(&lookup)).await {
        Ok(Some(chat)) => chat,
        Ok(None) => return fail(StatusCode::NOT_FOUND, "Chat not found"),
        Err(err) => return crate::async_err::internal_error("get chat", &err),
    };
    if !chat.temporary {
        return fail(StatusCode::CONFLICT, "chat is not temporary");
    }
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(chat_id = %id, "discard is a Phase-4 seam (ChatManager unavailable)");
        return fail(StatusCode::INTERNAL_SERVER_ERROR, "discard unavailable");
    };
    match cm.discard_chat(&id).await {
        Ok(()) => ok_empty(),
        Err(err) => {
            tracing::error!(chat_id = %id, %err, "discard failed");
            fail(StatusCode::INTERNAL_SERVER_ERROR, err)
        }
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/api/chats/{id}/discard", post(discard))
}

#[cfg(test)]
mod tests {
    use axum::body::to_bytes;

    use super::*;
    use mainframe_types::chat::NewChat;

    async fn read(resp: Response) -> (StatusCode, serde_json::Value) {
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        )
    }

    #[tokio::test]
    async fn discard_404s_for_an_unknown_chat() {
        let ctx = AppCtx::test_ctx();
        let (status, body) = read(discard(State(ctx.clone()), Path("nope".into())).await).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"], "Chat not found");
    }

    #[tokio::test]
    async fn discard_refuses_a_non_temporary_chat() {
        let ctx = AppCtx::test_ctx();
        let project = ctx
            .db
            .call(|db| db.projects.create("/tmp/discard-not-temp", None))
            .await
            .unwrap();
        let chat = ctx
            .db
            .call(move |db| {
                db.chats.create(&NewChat {
                    project_id: project.id,
                    adapter_id: "claude".to_string(),
                    ..Default::default()
                })
            })
            .await
            .unwrap();

        let (status, body) = read(discard(State(ctx.clone()), Path(chat.id)).await).await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(body["error"], "chat is not temporary");
    }

    fn test_chat(temporary: bool) -> Chat {
        let mut chat = crate::chat_deps::fallback_chat(&NewChat {
            project_id: "p1".to_string(),
            adapter_id: "claude".to_string(),
            temporary,
            ..Default::default()
        });
        chat.id = "c1".to_string();
        chat
    }

    #[test]
    fn refuse_if_temporary_is_none_for_a_normal_chat() {
        assert!(refuse_if_temporary(&test_chat(false), "pin").is_none());
    }

    #[test]
    fn refuse_if_temporary_fails_for_a_temporary_chat() {
        assert!(refuse_if_temporary(&test_chat(true), "pin").is_some());
    }

    // ── discard success (todo #346, AC 26 — needs a real ChatManager) ────────

    #[tokio::test]
    async fn discard_deletes_the_row_and_scratch_dir_and_404s_on_the_next_get() {
        let ctx = AppCtx::test_ctx_with_chat_manager();
        ctx.adapter_registry
            .register(crate::chat_test_support::StubAdapter::new("claude", false));
        let created = ctx
            .chat_manager
            .as_ref()
            .unwrap()
            .create_chat_with_defaults(
                NewChat {
                    project_id: mainframe_types::chat::NO_PROJECT_ID.to_string(),
                    adapter_id: "claude".to_string(),
                    temporary: true,
                    ..Default::default()
                },
                None,
                None,
            )
            .await;
        let chat_id = created.id;

        let scratch_path = ctx
            .db
            .call({
                let chat_id = chat_id.clone();
                move |db| Ok(db.chats.get(&chat_id)?.and_then(|c| c.scratch_path))
            })
            .await
            .unwrap()
            .expect("a temporary non-project chat has a scratch path");
        std::fs::create_dir_all(&scratch_path).unwrap();
        assert!(std::path::Path::new(&scratch_path).exists());

        let (status, _) = read(discard(State(ctx.clone()), Path(chat_id.clone())).await).await;
        assert_eq!(status, StatusCode::OK);

        assert!(
            !std::path::Path::new(&scratch_path).exists(),
            "the scratch directory must be removed"
        );
        let lookup = chat_id.clone();
        assert!(
            ctx.db
                .call(move |db| db.chats.get(&lookup))
                .await
                .unwrap()
                .is_none(),
            "the row must be deleted"
        );

        let (status, body) =
            read(crate::routes::chats::get_one(State(ctx.clone()), Path(chat_id)).await).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"], "Chat not found");
    }
}

// PORT STATUS: new for #346 (no TS twin)
// confidence: high
// todos: 0
// notes: discard's 404/fail split reads the chat once via ctx.db (matching the
// chat_commands.rs chat_exists pattern) before handing off to
// ChatManager::discard_chat for the live-state teardown, attachment delete,
// scratch-dir removal and row delete (chat_manager/discard.rs). A discard whose
// directory removal fails returns the deps error and leaves the row (and
// `chat.temporary`) intact, so a retry through this same route stays possible.
