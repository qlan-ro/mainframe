//! `POST /api/session-transcripts/resolve` — batch @-mention transcript lookup
//! (todo #240): given a set of chat ids, resolve each one's CLI transcript
//! location without the caller needing to already hold a session id.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::post;
use serde::Deserialize;

use mainframe_types::transcript::{
    ResolveTranscriptsResponse, TranscriptLocation, TranscriptResolution,
    TranscriptUnavailableReason,
};

use crate::ctx::AppCtx;
use crate::respond::{fail, ok};
use crate::routes::projects::parse_body;

const MAX_CHAT_IDS: usize = 500;

#[derive(Deserialize)]
struct ResolveBody {
    #[serde(rename = "chatIds")]
    chat_ids: Option<Vec<String>>,
}

/// Mirrors the daemon's identifier convention (`^[a-zA-Z0-9_-]+$`) — hand-rolled
/// so this route stays dependency-free like its `worktree_offer` sibling.
fn valid_id(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn parse_chat_ids(body: &Bytes) -> Result<Vec<String>, &'static str> {
    let parsed = parse_body::<ResolveBody>(body).ok_or("Invalid request body")?;
    let chat_ids = parsed.chat_ids.ok_or("chatIds is required")?;
    if chat_ids.is_empty() {
        return Err("chatIds must not be empty");
    }
    if chat_ids.len() > MAX_CHAT_IDS {
        return Err("chatIds exceeds the 500-entry limit");
    }
    if !chat_ids.iter().all(|id| valid_id(id)) {
        return Err("chatIds contains an invalid id");
    }
    Ok(chat_ids)
}

async fn resolve(State(ctx): State<Arc<AppCtx>>, body: Bytes) -> Response {
    let chat_ids = match parse_chat_ids(&body) {
        Ok(ids) => ids,
        Err(msg) => return fail(StatusCode::BAD_REQUEST, msg),
    };
    let mut resolutions = Vec::with_capacity(chat_ids.len());
    for chat_id in chat_ids {
        resolutions.push(resolve_one(&ctx, chat_id).await);
    }
    ok(ResolveTranscriptsResponse { resolutions })
}

/// Per-chat resolution order: missing/unreadable chat or project → `Unknown`;
/// no `claude_session_id` → `Unavailable(NeverStarted)`; unregistered adapter
/// → `Unknown`; otherwise defer to the adapter's `locate_transcript`.
async fn resolve_one(ctx: &Arc<AppCtx>, chat_id: String) -> TranscriptResolution {
    let chat = {
        let id = chat_id.clone();
        match ctx.db.call(move |db| db.chats.get(&id)).await {
            Ok(Some(chat)) => chat,
            Ok(None) | Err(_) => return TranscriptResolution::Unknown { chat_id },
        }
    };

    let Some(session_id) = chat.claude_session_id.clone() else {
        return TranscriptResolution::Unavailable {
            chat_id,
            reason: TranscriptUnavailableReason::NeverStarted,
        };
    };

    let project_id = chat.project_id.clone();
    let project_path = match ctx.db.call(move |db| db.projects.get(&project_id)).await {
        Ok(Some(project)) => project.path,
        Ok(None) | Err(_) => return TranscriptResolution::Unknown { chat_id },
    };
    let cwd = chat.worktree_path.clone().unwrap_or(project_path);

    let Some(adapter) = ctx.adapter_registry.get(&chat.adapter_id) else {
        return TranscriptResolution::Unknown { chat_id };
    };

    match adapter
        .locate_transcript(session_id, cwd, chat.session_file_path.clone())
        .await
    {
        Ok(None) => TranscriptResolution::Unknown { chat_id },
        Ok(Some(TranscriptLocation::Missing)) => TranscriptResolution::Unavailable {
            chat_id,
            reason: TranscriptUnavailableReason::TranscriptMissing,
        },
        Ok(Some(TranscriptLocation::Present(path))) => {
            TranscriptResolution::Resolved { chat_id, path }
        }
        Err(err) => {
            tracing::warn!(chat_id = %chat_id, %err, "locate_transcript failed");
            TranscriptResolution::Unknown { chat_id }
        }
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/api/session-transcripts/resolve", post(resolve))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use mainframe_adapter_api::{Adapter, AdapterError, AdapterSession, BoxFuture};
    use mainframe_types::adapter::{AdapterCapabilities, AdapterModel, SessionOptions};
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A minimal adapter whose `locate_transcript` returns a fixed result and
    /// counts how often it was consulted — everything else in the trait is
    /// unreachable from the resolve flow under test.
    struct StubAdapter {
        adapter_id: String,
        result: Option<TranscriptLocation>,
        calls: AtomicUsize,
    }

    impl StubAdapter {
        fn new(adapter_id: &str, result: Option<TranscriptLocation>) -> Arc<Self> {
            Arc::new(Self {
                adapter_id: adapter_id.to_string(),
                result,
                calls: AtomicUsize::new(0),
            })
        }
    }

    impl Adapter for StubAdapter {
        fn id(&self) -> &str {
            &self.adapter_id
        }
        fn name(&self) -> &str {
            &self.adapter_id
        }
        fn capabilities(&self) -> AdapterCapabilities {
            AdapterCapabilities { plan_mode: false }
        }
        fn is_installed(&self) -> BoxFuture<'_, Result<bool, AdapterError>> {
            Box::pin(async { Ok(true) })
        }
        fn get_version(&self) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
            Box::pin(async { Ok(None) })
        }
        fn list_models(&self) -> BoxFuture<'_, Result<Vec<AdapterModel>, AdapterError>> {
            Box::pin(async { Ok(vec![]) })
        }
        fn create_session(&self, _options: SessionOptions) -> Arc<dyn AdapterSession> {
            unreachable!("resolve_one never spawns a session")
        }
        fn kill_all(&self) {}

        fn locate_transcript(
            &self,
            _session_id: String,
            _project_path: String,
            _session_file_path: Option<String>,
        ) -> BoxFuture<'_, Result<Option<TranscriptLocation>, AdapterError>> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let result = self.result.clone();
            Box::pin(async move { Ok(result) })
        }
    }

    /// An adapter that never overrides `locate_transcript` — exercises the
    /// trait's own default (`Ok(None)`), distinct from a `StubAdapter` merely
    /// configured to return `None`.
    struct DefaultOnlyAdapter {
        adapter_id: String,
    }

    impl Adapter for DefaultOnlyAdapter {
        fn id(&self) -> &str {
            &self.adapter_id
        }
        fn name(&self) -> &str {
            &self.adapter_id
        }
        fn capabilities(&self) -> AdapterCapabilities {
            AdapterCapabilities { plan_mode: false }
        }
        fn is_installed(&self) -> BoxFuture<'_, Result<bool, AdapterError>> {
            Box::pin(async { Ok(true) })
        }
        fn get_version(&self) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
            Box::pin(async { Ok(None) })
        }
        fn list_models(&self) -> BoxFuture<'_, Result<Vec<AdapterModel>, AdapterError>> {
            Box::pin(async { Ok(vec![]) })
        }
        fn create_session(&self, _options: SessionOptions) -> Arc<dyn AdapterSession> {
            unreachable!("resolve_one never spawns a session")
        }
        fn kill_all(&self) {}
    }

    /// Seed a project + a chat with `claude_session_id` set, registered under
    /// `adapter_id`. Returns the chat id.
    async fn seed_chat(ctx: &Arc<AppCtx>, adapter_id: &str, with_session: bool) -> String {
        let path = format!("/tmp/session-transcripts-test-{}", nanoid::nanoid!());
        let project = ctx
            .db
            .call(move |db| db.projects.create(&path, None))
            .await
            .unwrap();
        let adapter_id = adapter_id.to_string();
        let chat = ctx
            .db
            .call(move |db| db.chats.create(&project.id, &adapter_id, None, None, None))
            .await
            .unwrap();
        if with_session {
            let id = chat.id.clone();
            ctx.db
                .call(move |db| {
                    db.chats.update(
                        &id,
                        &mainframe_db::ChatUpdate {
                            claude_session_id: Some("session-1".to_string()),
                            ..Default::default()
                        },
                    )
                })
                .await
                .unwrap();
        }
        chat.id
    }

    async fn body_json(resp: Response) -> (StatusCode, serde_json::Value) {
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    async fn post_resolve(ctx: &Arc<AppCtx>, body: &str) -> (StatusCode, serde_json::Value) {
        body_json(resolve(State(ctx.clone()), Bytes::from(body.to_string())).await).await
    }

    #[tokio::test]
    async fn resolves_a_present_transcript_from_a_claude_shaped_adapter() {
        let ctx = AppCtx::test_ctx();
        let stub = StubAdapter::new(
            "claude",
            Some(TranscriptLocation::Present("/p.jsonl".into())),
        );
        ctx.adapter_registry.register(stub.clone());
        let chat_id = seed_chat(&ctx, "claude", true).await;

        let (status, body) = post_resolve(&ctx, &format!(r#"{{"chatIds":["{chat_id}"]}}"#)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body["data"]["resolutions"][0],
            serde_json::json!({ "state": "resolved", "chatId": chat_id, "path": "/p.jsonl" })
        );
    }

    #[tokio::test]
    async fn reports_unavailable_transcript_missing_when_the_adapter_says_missing() {
        let ctx = AppCtx::test_ctx();
        let stub = StubAdapter::new("claude", Some(TranscriptLocation::Missing));
        ctx.adapter_registry.register(stub.clone());
        let chat_id = seed_chat(&ctx, "claude", true).await;

        let (_, body) = post_resolve(&ctx, &format!(r#"{{"chatIds":["{chat_id}"]}}"#)).await;
        assert_eq!(
            body["data"]["resolutions"][0],
            serde_json::json!({ "state": "unavailable", "chatId": chat_id, "reason": "transcript-missing" })
        );
    }

    #[tokio::test]
    async fn reports_never_started_and_never_consults_the_adapter() {
        let ctx = AppCtx::test_ctx();
        let stub = StubAdapter::new(
            "claude",
            Some(TranscriptLocation::Present("/p.jsonl".into())),
        );
        ctx.adapter_registry.register(stub.clone());
        let chat_id = seed_chat(&ctx, "claude", false).await;

        let (_, body) = post_resolve(&ctx, &format!(r#"{{"chatIds":["{chat_id}"]}}"#)).await;
        assert_eq!(
            body["data"]["resolutions"][0],
            serde_json::json!({ "state": "unavailable", "chatId": chat_id, "reason": "never-started" })
        );
        assert_eq!(stub.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn resolves_a_present_transcript_from_a_non_claude_adapter() {
        let ctx = AppCtx::test_ctx();
        let stub = StubAdapter::new(
            "codex",
            Some(TranscriptLocation::Present("/rollout.jsonl".into())),
        );
        ctx.adapter_registry.register(stub.clone());
        let chat_id = seed_chat(&ctx, "codex", true).await;

        let (_, body) = post_resolve(&ctx, &format!(r#"{{"chatIds":["{chat_id}"]}}"#)).await;
        assert_eq!(
            body["data"]["resolutions"][0],
            serde_json::json!({ "state": "resolved", "chatId": chat_id, "path": "/rollout.jsonl" })
        );
    }

    #[tokio::test]
    async fn reports_unknown_for_a_default_adapter_and_an_unregistered_adapter() {
        let ctx = AppCtx::test_ctx();
        ctx.adapter_registry.register(Arc::new(DefaultOnlyAdapter {
            adapter_id: "default-only".to_string(),
        }));
        let default_chat = seed_chat(&ctx, "default-only", true).await;
        let unregistered_chat = seed_chat(&ctx, "no-such-adapter", true).await;

        let (_, body) = post_resolve(
            &ctx,
            &format!(r#"{{"chatIds":["{default_chat}","{unregistered_chat}"]}}"#),
        )
        .await;
        assert_eq!(
            body["data"]["resolutions"][0],
            serde_json::json!({ "state": "unknown", "chatId": default_chat })
        );
        assert_eq!(
            body["data"]["resolutions"][1],
            serde_json::json!({ "state": "unknown", "chatId": unregistered_chat })
        );
    }

    #[tokio::test]
    async fn rejects_a_missing_chat_ids_field() {
        let ctx = AppCtx::test_ctx();
        let (status, body) = post_resolve(&ctx, "{}").await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "chatIds is required");
    }

    #[tokio::test]
    async fn rejects_an_empty_chat_ids_array() {
        let ctx = AppCtx::test_ctx();
        let (status, body) = post_resolve(&ctx, r#"{"chatIds":[]}"#).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "chatIds must not be empty");
    }

    #[tokio::test]
    async fn rejects_an_id_that_escapes_the_identifier_pattern() {
        let ctx = AppCtx::test_ctx();
        let (status, body) = post_resolve(&ctx, r#"{"chatIds":["../etc/passwd"]}"#).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "chatIds contains an invalid id");

        let (status, body) = post_resolve(&ctx, r#"{"chatIds":["a/b"]}"#).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "chatIds contains an invalid id");
    }
}

// PORT STATUS: NEW route (#240) — no TS twin, added alongside the Rust-only
// transcript-location resolution (Group B of the todo-240 plan).
// confidence: high
// todos: 0
