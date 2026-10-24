use super::*;
use crate::acp_ws::ports::ManagerPorts;
use crate::{AppCtx, Db};
use mainframe_acp::ResumePort;
use mainframe_types::acp::jsonrpc::RequestId;
use serde_json::json;

struct Fixture {
    directory: tempfile::TempDir,
    ctx: Arc<AppCtx>,
    chat_id: String,
    source: PathBuf,
}

fn context(db: Db, data: PathBuf) -> Arc<AppCtx> {
    let hub = Arc::new(FacadeHub::default().with_history_tails(data.join("tails")));
    let ctx = Arc::new(
        AppCtx::test_builder(db, data)
            .facade_hub(hub)
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
    ctx
}

async fn fixture() -> Fixture {
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
    let ctx = context(db, directory.path().join("data"));
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
    Fixture {
        directory,
        ctx,
        chat_id,
        source,
    }
}

fn request(chat_id: &str) -> JsonRpcRequest {
    JsonRpcRequest {
        jsonrpc: "2.0".into(),
        id: Some(RequestId::Number(1)),
        method: "session/resume".into(),
        params: Some(json!({"sessionId":chat_id,
        "cwd":"/tmp", "replayFrom":{"type":"start"},
        "_meta":{"_mainframe.dev":{"window":{"containers":40}}}})),
    }
}

fn options() -> ResumeOptions {
    ResumeOptions {
        result_previews: true,
        windowed_history: true,
    }
}

async fn persist(fixture: &Fixture) -> (JsonRpcResponse, ResumeReplay) {
    let manager = fixture.ctx.chat.chat_manager.clone();
    manager.resume_transcript(&fixture.chat_id).await;
    let proof = manager.history_validation(&fixture.chat_id);
    assert!(proof.is_some());
    let request = request(&fixture.chat_id);
    let port = ManagerPorts::new(Some(manager.clone()));
    let (reply, replay) =
        mainframe_acp::dispatch_resume_with(request.clone(), &port, None, options()).await;
    let replay_copy =
        mainframe_acp::resume::persisted::PreparedHistoryTail::capture(&reply, &replay).unwrap();
    fixture.ctx.chat.facade_hub.persist_resume(
        manager,
        request,
        reply.clone(),
        replay,
        options(),
        proof,
    );
    let store = fixture.ctx.chat.facade_hub.history_tails.as_ref().unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        while store.manifest(&fixture.chat_id).await.is_none() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let (_, copy) = replay_copy.replay(None, None);
    (reply, copy)
}

fn restart(fixture: &Fixture) -> Arc<AppCtx> {
    context(
        fixture.ctx.core.db.clone(),
        fixture.directory.path().join("data"),
    )
}

#[tokio::test]
async fn restart_replays_the_tail_without_canonical_restoration_then_pages_full_history() {
    let fixture = fixture().await;
    let (_, original) = persist(&fixture).await;
    let ctx = restart(&fixture);
    let hub = &ctx.chat.facade_hub;
    let manager = &ctx.chat.chat_manager;
    assert!(hub.initial_history_ready(manager, &fixture.chat_id).await);
    let (reply, cached) = hub
        .persisted_resume(manager, &request(&fixture.chat_id), options(), None)
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(cached.updates).unwrap(),
        serde_json::to_value(original.updates).unwrap()
    );
    assert!(manager.history_validation(&fixture.chat_id).is_none());
    let (_, conn, _rx) = hub.register("claude".into());
    conn.mark_windowed_history_opted_in();
    hub.begin_resume(&conn, &fixture.chat_id);
    let seed = crate::acp_ws::hub::ResumeSeed {
        containers: &cached.containers,
        reply: &reply,
        replied: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        completed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        redelivered_gate: None,
        preview_ids: &cached.preview_ids,
    };
    hub.reset_session(&conn, &fixture.chat_id, seed, |_| {});
    let snapshot = ManagerPorts::new(Some(manager.clone()))
        .resume_snapshot(&fixture.chat_id)
        .await;
    assert_eq!(snapshot.messages.len(), 100);
    hub.seed_history_snapshot(&fixture.chat_id, &snapshot.messages);
    let page = mainframe_acp::history_page::prepare(
        &snapshot.messages,
        &mainframe_types::acp::extensions::HistoryPageParams {
            session_id: fixture.chat_id.clone(),
            before: "m60".into(),
            containers: Some(40),
            items: None,
            until_item_id: None,
        },
        Default::default(),
    );
    assert_eq!(page.result.history.floor_item_id.as_deref(), Some("m20"));
    assert_eq!(page.containers.len(), 40);
    assert!(!hub.initial_history_ready(manager, &fixture.chat_id).await);
    assert_eq!(
        mainframe_acp::history_search::search(&snapshot.messages, "message 1").total,
        11
    );
    ctx.chat.chat_manager.dispose();
    fixture.ctx.chat.chat_manager.dispose();
}

#[tokio::test]
async fn corrupt_body_and_changed_sources_fall_back_and_revision_resumes_skip_the_cache() {
    let fixture = fixture().await;
    persist(&fixture).await;
    let ctx = restart(&fixture);
    let hub = &ctx.chat.facade_hub;
    let manager = &ctx.chat.chat_manager;
    let mut reconnect = request(&fixture.chat_id);
    reconnect.params.as_mut().unwrap()["replayFrom"] =
        json!({"type":"revision","epoch":"old","revision":0});
    assert!(
        hub.persisted_resume(manager, &reconnect, options(), None)
            .await
            .is_none()
    );
    let body = fixture
        .directory
        .path()
        .join("data/tails")
        .join(format!("{}.tail.json", fixture.chat_id));
    tokio::fs::write(body, "corrupt").await.unwrap();
    assert!(!hub.initial_history_ready(manager, &fixture.chat_id).await);
    assert!(
        hub.persisted_resume(manager, &request(&fixture.chat_id), options(), None)
            .await
            .is_none()
    );
    tokio::fs::write(&fixture.source, "changed").await.unwrap();
    assert!(!hub.initial_history_ready(manager, &fixture.chat_id).await);
    ctx.chat.chat_manager.dispose();
    fixture.ctx.chat.chat_manager.dispose();
}

#[tokio::test]
async fn store_rejects_mixed_generations_invalid_ids_and_oversized_files() {
    let fixture = fixture().await;
    persist(&fixture).await;
    let store = fixture.ctx.chat.facade_hub.history_tails.as_ref().unwrap();
    assert!(store.manifest("../outside").await.is_none());
    let mut manifest = store.manifest(&fixture.chat_id).await.unwrap();
    manifest.generation = "different".into();
    assert!(store.tail(&manifest).await.is_none());
    let body = fixture
        .directory
        .path()
        .join("data/tails")
        .join(format!("{}.tail.json", fixture.chat_id));
    let file = tokio::fs::File::create(body).await.unwrap();
    file.set_len(8 * 1024 * 1024 + 1).await.unwrap();
    manifest.generation = store.manifest(&fixture.chat_id).await.unwrap().generation;
    assert!(store.tail(&manifest).await.is_none());
    fixture.ctx.chat.chat_manager.dispose();
}
