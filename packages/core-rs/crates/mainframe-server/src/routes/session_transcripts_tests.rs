use super::*;
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
        AdapterCapabilities {
            plan_mode: false,
            auto_mode: false,
            no_persistence: false,
            fork: false,
        }
    }
    fn is_installed(&self) -> BoxFuture<'_, Result<bool, AdapterError>> {
        Box::pin(async { Ok(true) })
    }
    fn get_version(&self) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
        Box::pin(async { Ok(None) })
    }
    fn catalog(&self) -> Vec<AdapterModel> {
        Vec::new()
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
        AdapterCapabilities {
            plan_mode: false,
            auto_mode: false,
            no_persistence: false,
            fork: false,
        }
    }
    fn is_installed(&self) -> BoxFuture<'_, Result<bool, AdapterError>> {
        Box::pin(async { Ok(true) })
    }
    fn get_version(&self) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
        Box::pin(async { Ok(None) })
    }
    fn catalog(&self) -> Vec<AdapterModel> {
        Vec::new()
    }
    fn create_session(&self, _options: SessionOptions) -> Arc<dyn AdapterSession> {
        unreachable!("resolve_one never spawns a session")
    }
    fn kill_all(&self) {}
}

/// Seed a project + a chat with `vendor_session_id` set, registered under
/// `adapter_id`. Returns the chat id.
async fn seed_chat(ctx: &Arc<AppCtx>, adapter_id: &str, with_session: bool) -> String {
    let path = format!("/tmp/session-transcripts-test-{}", nanoid::nanoid!());
    let project = ctx
        .core
        .db
        .call(move |db| db.projects.create(&path, None))
        .await
        .unwrap();
    let adapter_id = adapter_id.to_string();
    let chat = ctx
        .core
        .db
        .call(move |db| {
            db.chats.create(&mainframe_types::chat::NewChat {
                project_id: project.id,
                adapter_id,
                ..Default::default()
            })
        })
        .await
        .unwrap();
    if with_session {
        let id = chat.id.clone();
        ctx.core
            .db
            .call(move |db| {
                db.chats.update(
                    &id,
                    &mainframe_types::chat_patch::ChatPatch {
                        vendor_session_id: Some("session-1".to_string()),
                        ..Default::default()
                    },
                )
            })
            .await
            .unwrap();
    }
    chat.id
}

use crate::test_support::body_json;

async fn post_resolve(ctx: &Arc<AppCtx>, body: &str) -> (StatusCode, serde_json::Value) {
    body_json(resolve(State(ctx.clone()), Bytes::from(body.to_string())).await)
        .await
        .unwrap()
}

#[tokio::test]
async fn resolves_a_present_transcript_from_a_claude_shaped_adapter() {
    let ctx = AppCtx::test_ctx();
    let stub = StubAdapter::new(
        "claude",
        Some(TranscriptLocation::Present("/p.jsonl".into())),
    );
    ctx.core.adapter_registry.register(stub.clone());
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
    ctx.core.adapter_registry.register(stub.clone());
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
    ctx.core.adapter_registry.register(stub.clone());
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
    ctx.core.adapter_registry.register(stub.clone());
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
    ctx.core
        .adapter_registry
        .register(Arc::new(DefaultOnlyAdapter {
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
