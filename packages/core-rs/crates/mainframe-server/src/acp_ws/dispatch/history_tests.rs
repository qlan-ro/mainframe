use std::sync::Arc;

use serde_json::{Value, json};

use crate::acp_ws::dispatch::handle_inbound;
use crate::{AppCtx, Db};

async fn chat_with_history() -> (tempfile::TempDir, Arc<AppCtx>, String) {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("session.jsonl");
    let contents: String = (0..100)
        .map(|i| {
            format!(
                "{}\n",
                json!({"type":"user","uuid":format!("m{i}"),
                "sessionId":"session","timestamp":"2026-10-01T00:00:00Z",
                "message":{"role":"user","content":format!("message {i}")}})
            )
        })
        .collect();
    tokio::fs::write(&source, contents).await.unwrap();
    let db = Db::spawn(|| mainframe_db::DatabaseManager::open(std::path::Path::new(":memory:")))
        .unwrap();
    let ctx = Arc::new(
        AppCtx::test_builder(db, directory.path().join("data"))
            .build()
            .unwrap(),
    );
    ctx.core.adapter_registry.register(Arc::new(
        mainframe_adapter_claude::adapter::ClaudeAdapter::new(
            ctx.core.background_tasks.clone(),
            ctx.core.claude_workflows.clone(),
            ctx.core.resolved_path.clone(),
        ),
    ));
    let path = directory.path().to_string_lossy().into_owned();
    let file = source.to_string_lossy().into_owned();
    let chat_id = ctx
        .core
        .db
        .call(move |db| {
            let project = db.projects.create(&path, None)?;
            let chat = db.chats.create(&mainframe_types::chat::NewChat {
                project_id: project.id,
                adapter_id: "claude".into(),
                ..Default::default()
            })?;
            db.chats.update(
                &chat.id,
                &mainframe_types::chat_patch::ChatPatch {
                    vendor_session_id: Some("session".into()),
                    session_file_path: Some(file),
                    ..Default::default()
                },
            )?;
            Ok(chat.id)
        })
        .await
        .unwrap();
    (directory, ctx, chat_id)
}

async fn call(ctx: &Arc<AppCtx>, method: &str, params: Value) -> Value {
    let (_, conn, mut rx) = ctx.chat.facade_hub.register("claude".into());
    conn.mark_negotiated();
    let daemon = mainframe_acp::DaemonInfo {
        version: "test".into(),
        heartbeat_interval_ms: 15000,
    };
    let text = json!({"jsonrpc":"2.0","id":7,"method":method,"params":params}).to_string();
    assert!(handle_inbound(&text, &daemon, ctx, &conn).await.is_none());
    let reply = tokio::time::timeout(std::time::Duration::from_secs(5), rx.recv())
        .await
        .unwrap()
        .unwrap();
    serde_json::from_str(&reply).unwrap()
}

#[tokio::test]
async fn history_around_and_search_are_routed_and_answered() {
    let (_keep, ctx, chat) = chat_with_history().await;
    let found = call(
        &ctx,
        "_mainframe.dev/history_search",
        json!({"sessionId":chat,"query":"message 7"}),
    )
    .await;
    assert_eq!(found["id"], 7);
    assert_eq!(found["result"]["total"], 11);

    let around = call(
        &ctx,
        "_mainframe.dev/history_around",
        json!({"sessionId":chat,"itemId":"m50","before":3,"after":2}),
    )
    .await;
    let result = &around["result"];
    assert_eq!(result["hasBefore"], true);
    assert_eq!(result["hasAfter"], true);
    assert!(result.get("stale").is_none());
    let first = result["firstItemId"].as_str().unwrap();
    let last = result["lastItemId"].as_str().unwrap();
    assert!(
        first.ends_with(":m47") && last.ends_with(":m52"),
        "{result}"
    );
    assert!(result["targetItemId"].as_str().unwrap().ends_with(":m50"));

    let missing = call(
        &ctx,
        "_mainframe.dev/history_around",
        json!({"sessionId":chat,"itemId":"nope"}),
    )
    .await;
    assert_eq!(missing["result"]["stale"], true);

    let bad = call(
        &ctx,
        "_mainframe.dev/history_around",
        json!({"sessionId":chat}),
    )
    .await;
    assert!(bad["error"].is_object());
}
