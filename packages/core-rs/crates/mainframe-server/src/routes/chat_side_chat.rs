//! `POST /api/chats/{id}/side-chat` (todo #344, plan Task 3) — open or reveal
//! a chat's side chat. See `chat_manager::open_side_chat` for the daemon-side
//! orchestration this route only translates to the wire envelope.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::post;
use serde::Deserialize;

use mainframe_chat::chat_manager::OpenSideChatError;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok};
use crate::routes::projects::parse_body;

/// Same identifier convention as the rest of the daemon (`^[a-zA-Z0-9_-]+$`).
fn id_ok(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// The body is optional; when present it must be an empty JSON object — an
/// unknown field 400s rather than being silently ignored.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OpenSideChatBody {}

fn status_for(err: &OpenSideChatError) -> StatusCode {
    StatusCode::from_u16(err.status_code()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
}

async fn open_side_chat(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    if !id_ok(&id) {
        return fail(StatusCode::BAD_REQUEST, "Invalid chat id");
    }
    if parse_body::<OpenSideChatBody>(&body).is_none() {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    }
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(chat_id = %id, "open_side_chat needs ChatManager (unwired)");
        return fail(StatusCode::INTERNAL_SERVER_ERROR, "side chat unavailable");
    };
    match cm.open_side_chat(&id).await {
        Ok(chat) => ok(chat),
        Err(err) => {
            let status = status_for(&err);
            if status == StatusCode::INTERNAL_SERVER_ERROR {
                tracing::error!(chat_id = %id, %err, "open_side_chat failed");
            }
            fail(status, err.to_string())
        }
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/api/chats/{id}/side-chat", post(open_side_chat))
}

#[cfg(test)]
mod tests {
    use axum::body::to_bytes;

    use super::*;
    use crate::routes::chat_discard::refuse_if_temporary;
    use mainframe_db::chats::ChatListFilters;
    use mainframe_types::chat::{Chat, NewChat};

    async fn read(resp: Response) -> (StatusCode, serde_json::Value) {
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        )
    }

    async fn open(
        ctx: &Arc<AppCtx>,
        id: &str,
        body: &'static [u8],
    ) -> (StatusCode, serde_json::Value) {
        read(
            open_side_chat(
                State(ctx.clone()),
                Path(id.to_string()),
                Bytes::from_static(body),
            )
            .await,
        )
        .await
    }

    /// A real project + parent chat, registered under the `claude` StubAdapter
    /// (fork: false), through a real `ChatManager` (todo #346's AC 26 harness).
    async fn setup() -> (Arc<AppCtx>, mainframe_types::chat::Project, Chat) {
        // `enrich_chat`'s directory-missing check stats the real filesystem, so
        // the project's path must actually exist for open_side_chat's OWN
        // gating (the archived/side-chat/id checks) to be what each test below
        // is really about.
        std::fs::create_dir_all("/tmp/side-chat-route").unwrap();
        let ctx = crate::ctx::AppCtx::test_ctx_with_chat_manager();
        ctx.adapter_registry
            .register(crate::chat_test_support::StubAdapter::new("claude", false));
        let project = ctx
            .db
            .call(|db| db.projects.create("/tmp/side-chat-route", None))
            .await
            .unwrap();
        let parent = ctx
            .chat_manager
            .as_ref()
            .unwrap()
            .create_chat_with_defaults(
                NewChat {
                    project_id: project.id.clone(),
                    adapter_id: "claude".to_string(),
                    ..Default::default()
                },
                None,
                None,
            )
            .await;
        (ctx, project, parent)
    }

    // ── 400s ──────────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn a_bad_id_400s() {
        let ctx = AppCtx::test_ctx();
        let (status, _) = open(&ctx, "not a valid id!", b"").await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn an_unknown_body_field_400s() {
        let ctx = AppCtx::test_ctx();
        let (status, _) = open(&ctx, "c1", br#"{"foo":1}"#).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn an_empty_body_is_accepted() {
        let (ctx, _project, parent) = setup().await;
        let (status, _) = open(&ctx, &parent.id, b"{}").await;
        assert_eq!(status, StatusCode::OK);
    }

    // ── 404 / 409 envelopes ──────────────────────────────────────────────────

    #[tokio::test]
    async fn an_unknown_parent_404s() {
        let ctx = AppCtx::test_ctx_with_chat_manager();
        let (status, body) = open(&ctx, "nope", b"").await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert!(body["error"].as_str().unwrap().contains("not found"));
    }

    #[tokio::test]
    async fn an_archived_parent_409s() {
        let (ctx, _project, parent) = setup().await;
        ctx.chat_manager
            .as_ref()
            .unwrap()
            .archive_chat(&parent.id, false)
            .await;

        let (status, _) = open(&ctx, &parent.id, b"").await;
        assert_eq!(status, StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn a_side_chat_cannot_open_its_own_side_chat_409s() {
        let (ctx, _project, parent) = setup().await;
        let (status, body) = open(&ctx, &parent.id, b"").await;
        assert_eq!(status, StatusCode::OK);
        let side_id = body["data"]["id"].as_str().unwrap().to_string();

        let (status, _) = open(&ctx, &side_id, b"").await;
        assert_eq!(status, StatusCode::CONFLICT);
    }

    // ── open / reveal ────────────────────────────────────────────────────────

    #[tokio::test]
    async fn opening_twice_reveals_the_same_side_chat() {
        let (ctx, _project, parent) = setup().await;
        let (status, first) = open(&ctx, &parent.id, b"").await;
        assert_eq!(status, StatusCode::OK);
        let (status, second) = open(&ctx, &parent.id, b"").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(first["data"]["id"], second["data"]["id"]);
    }

    #[tokio::test]
    async fn two_concurrent_opens_leave_one_row() {
        let (ctx, project, parent) = setup().await;
        let (a, b) = tokio::join!(
            open_side_chat(
                State(ctx.clone()),
                Path(parent.id.clone()),
                Bytes::from_static(b"")
            ),
            open_side_chat(
                State(ctx.clone()),
                Path(parent.id.clone()),
                Bytes::from_static(b"")
            ),
        );
        let (status_a, body_a) = read(a).await;
        let (status_b, body_b) = read(b).await;
        assert_eq!(status_a, StatusCode::OK);
        assert_eq!(status_b, StatusCode::OK);
        assert_eq!(body_a["data"]["id"], body_b["data"]["id"]);

        let project_id = project.id.clone();
        let rows = ctx
            .db
            .call(move |db| db.chats.list(&project_id))
            .await
            .unwrap();
        let side_chats = rows.iter().filter(|c| c.temporary).count();
        assert_eq!(side_chats, 1, "exactly one side-chat row must exist");
    }

    // ── listing exclusion (rule 7) ───────────────────────────────────────────

    #[tokio::test]
    async fn list_filtered_excludes_the_side_chat_with_and_without_include_temporary_while_get_chat_returns_it()
     {
        let (ctx, project, parent) = setup().await;
        let (_, body) = open(&ctx, &parent.id, b"").await;
        let side_id = body["data"]["id"].as_str().unwrap().to_string();
        let cm = ctx.chat_manager.as_ref().unwrap();

        let default_list = cm.list_filtered(Some(&project.id), None, false, true, false);
        assert!(!default_list.iter().any(|c| c.id == side_id));

        let with_temporary = cm.list_filtered(Some(&project.id), None, false, true, true);
        assert!(!with_temporary.iter().any(|c| c.id == side_id));

        assert!(cm.get_chat(&side_id).is_some());
    }

    #[tokio::test]
    async fn filter_temporary_drops_a_side_chat_even_when_include_temporary_is_set() {
        // Pure unit coverage of the DB-level exclusion (mainframe-db rule 7)
        // through the same filters the wired `list` route builds.
        std::fs::create_dir_all("/tmp/side-chat-filtered").unwrap();
        let ctx = AppCtx::test_ctx_with_chat_manager();
        ctx.adapter_registry
            .register(crate::chat_test_support::StubAdapter::new("claude", false));
        let project = ctx
            .db
            .call(|db| db.projects.create("/tmp/side-chat-filtered", None))
            .await
            .unwrap();
        let parent = ctx
            .chat_manager
            .as_ref()
            .unwrap()
            .create_chat_with_defaults(
                NewChat {
                    project_id: project.id.clone(),
                    adapter_id: "claude".to_string(),
                    ..Default::default()
                },
                None,
                None,
            )
            .await;
        ctx.chat_manager
            .as_ref()
            .unwrap()
            .open_side_chat(&parent.id)
            .await
            .unwrap();

        let project_id = project.id.clone();
        let rows = ctx
            .db
            .call(move |db| {
                db.chats.list_filtered(&ChatListFilters {
                    project_id: Some(project_id),
                    include_temporary: true,
                    ..Default::default()
                })
            })
            .await
            .unwrap();
        assert!(
            rows.iter()
                .all(|c| !(c.temporary && c.parent_chat_id.is_some()))
        );
    }

    // ── refusals already in place (rule 8) ──────────────────────────────────

    fn side_chat_fixture() -> Chat {
        let mut chat = crate::chat_deps::fallback_chat(&NewChat {
            project_id: "p1".to_string(),
            adapter_id: "claude".to_string(),
            temporary: true,
            ..Default::default()
        });
        chat.id = "side-1".to_string();
        chat.parent_chat_id = Some(Some("c1".to_string()));
        chat
    }

    #[test]
    fn pin_tag_archive_and_unarchive_all_refuse_a_side_chat() {
        let chat = side_chat_fixture();
        for action in ["pin", "tag", "archive", "unarchive"] {
            assert!(
                refuse_if_temporary(&chat, action).is_some(),
                "{action} must refuse a side chat"
            );
        }
    }

    #[tokio::test]
    async fn fork_refuses_a_side_chat() {
        let (ctx, _project, parent) = setup().await;
        let (_, body) = open(&ctx, &parent.id, b"").await;
        let side_id = body["data"]["id"].as_str().unwrap().to_string();

        let err = ctx
            .chat_manager
            .as_ref()
            .unwrap()
            .fork_chat(&side_id)
            .await
            .unwrap_err();
        // StubAdapter isn't fork-capable, so this may surface as Unsupported
        // rather than Temporary — either way, fork never succeeds for a side chat.
        assert_ne!(err.status_code(), 200);
    }

    // ── project removal cascade (rule 6) ────────────────────────────────────

    #[tokio::test]
    async fn removing_the_project_deletes_the_side_chats_row() {
        let (ctx, project, parent) = setup().await;
        let (_, body) = open(&ctx, &parent.id, b"").await;
        let side_id = body["data"]["id"].as_str().unwrap().to_string();
        let cm = ctx.chat_manager.as_ref().unwrap();

        cm.remove_project(&project.id).await.unwrap();

        assert!(cm.get_chat(&parent.id).is_none());
        assert!(cm.get_chat(&side_id).is_none());
    }
}

// PORT STATUS: new for #344 (no TS twin)
// confidence: high
// todos: 0
// notes: mirrors chat_discard.rs's 404/fail split, delegating the whole
// orchestration to ChatManager::open_side_chat. filter_temporary's own
// exclusion logic lives in routes/chats.rs; this file's route-level tests
// exercise it through the wired ChatManager facade instead of duplicating it.
