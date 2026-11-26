//! Turn-end and shutdown refresh of the persisted tail and history snapshot.
use super::*;
use mainframe_chat::chat_surface::{ChatSurface as _, ChatSurfaceEvent, TurnStopReason};

/// Appends one prompt to the transcript, the way the CLI records a turn.
async fn run_a_turn(fixture: &Fixture, index: usize) {
    use tokio::io::AsyncWriteExt as _;
    let line = json!({"type":"user","uuid":format!("m{index}"),
        "sessionId":"session","timestamp":"2026-10-01T00:00:00Z",
        "message":{"role":"user","content":format!("message {index}")}});
    let mut file = tokio::fs::OpenOptions::new()
        .append(true)
        .open(&fixture.source)
        .await
        .unwrap();
    file.write_all(format!("{line}\n").as_bytes())
        .await
        .unwrap();
}

fn finish_turn(ctx: &AppCtx, chat_id: &str) {
    ctx.chat
        .facade_hub
        .on_chat_surface_event(ChatSurfaceEvent::TurnFinished {
            chat_id: chat_id.to_owned(),
            stop_reason: TurnStopReason::Completed,
        });
}

/// The transcript length the stored history snapshot is pinned to.
async fn snapshot_len(fixture: &Fixture) -> Option<u64> {
    let path = fixture
        .directory
        .path()
        .join("data/cache/history")
        .join(format!("{}.json", fixture.chat_id));
    let bytes = tokio::fs::read(path).await.ok()?;
    let snapshot: Value = serde_json::from_slice(&bytes).ok()?;
    snapshot["fingerprint"]["sources"][0]["len"].as_u64()
}

async fn transcript_len(fixture: &Fixture) -> u64 {
    tokio::fs::metadata(&fixture.source).await.unwrap().len()
}

/// The first window a restarted daemon serves from its persisted tail.
async fn restart_and_replay(fixture: &Fixture) -> Option<ResumeReplay> {
    let ctx = restart(fixture);
    let hub = &ctx.chat.facade_hub;
    let manager = &ctx.chat.chat_manager;
    let ready = hub.initial_history_ready(manager, &fixture.chat_id).await;
    let replay = hub
        .persisted_resume(manager, &request(&fixture.chat_id), options(), None)
        .await
        .map(|(_, replay)| replay);
    assert_eq!(ready, replay.is_some());
    manager.dispose();
    replay
}

/// The first window a daemon with no caches at all would send.
async fn cold_replay(fixture: &Fixture) -> ResumeReplay {
    let ctx = context(
        fixture.ctx.core.db.clone(),
        fixture.directory.path().join("cold"),
    );
    let manager = ctx.chat.chat_manager.clone();
    let port = ManagerPorts::new(Some(manager.clone()));
    let (_, replay) =
        mainframe_acp::dispatch_resume_with(request(&fixture.chat_id), &port, None, options())
            .await;
    manager.dispose();
    replay
}

fn updates(replay: &ResumeReplay) -> Value {
    serde_json::to_value(&replay.updates).unwrap()
}

#[tokio::test]
async fn a_finished_turn_rewrites_the_tail_and_snapshot_for_the_next_start() {
    let fixture = fixture().await;
    persist(&fixture).await;
    let ctx = &fixture.ctx;
    ctx.chat
        .facade_hub
        .attach_history_refresh(&ctx.chat.chat_manager);
    run_a_turn(&fixture, 100).await;
    assert!(restart_and_replay(&fixture).await.is_none());

    finish_turn(ctx, &fixture.chat_id);
    let expected = transcript_len(&fixture).await;
    mainframe_runtime::test_support::poll_until(
        std::time::Duration::from_secs(5),
        std::time::Duration::from_millis(20),
        async || {
            snapshot_len(&fixture).await == Some(expected)
                && restart_and_replay(&fixture).await.is_some()
        },
    )
    .await
    .expect("the refresh rewrote both caches");

    let cached = restart_and_replay(&fixture).await.unwrap();
    assert_eq!(updates(&cached), updates(&cold_replay(&fixture).await));
    assert!(updates(&cached).to_string().contains("message 100"));
    fixture.ctx.chat.chat_manager.dispose();
}

#[tokio::test]
async fn shutdown_finishes_a_pending_refresh() {
    let fixture = fixture().await;
    persist(&fixture).await;
    let ctx = &fixture.ctx;
    ctx.chat
        .facade_hub
        .attach_history_refresh(&ctx.chat.chat_manager);
    run_a_turn(&fixture, 100).await;

    finish_turn(ctx, &fixture.chat_id);
    ctx.chat
        .facade_hub
        .flush_history_refreshes(std::time::Duration::from_secs(5))
        .await;

    assert_eq!(
        snapshot_len(&fixture).await,
        Some(transcript_len(&fixture).await)
    );
    let cached = restart_and_replay(&fixture).await.unwrap();
    assert_eq!(updates(&cached), updates(&cold_replay(&fixture).await));
    fixture.ctx.chat.chat_manager.dispose();
}

#[tokio::test]
async fn a_change_after_the_refresh_falls_back_to_the_full_read() {
    let fixture = fixture().await;
    persist(&fixture).await;
    let ctx = &fixture.ctx;
    ctx.chat
        .facade_hub
        .attach_history_refresh(&ctx.chat.chat_manager);
    run_a_turn(&fixture, 100).await;
    finish_turn(ctx, &fixture.chat_id);
    ctx.chat
        .facade_hub
        .flush_history_refreshes(std::time::Duration::from_secs(5))
        .await;
    run_a_turn(&fixture, 101).await;

    assert!(restart_and_replay(&fixture).await.is_none());
    let restarted = restart(&fixture);
    let snapshot = ManagerPorts::new(Some(restarted.chat.chat_manager.clone()))
        .resume_snapshot(&fixture.chat_id)
        .await;
    assert_eq!(snapshot.messages.len(), 102);
    restarted.chat.chat_manager.dispose();
    fixture.ctx.chat.chat_manager.dispose();
}

#[tokio::test]
async fn shutdown_with_no_finished_turn_writes_nothing() {
    let fixture = fixture().await;
    let ctx = &fixture.ctx;
    ctx.chat
        .facade_hub
        .attach_history_refresh(&ctx.chat.chat_manager);
    ctx.chat
        .facade_hub
        .flush_history_refreshes(std::time::Duration::from_secs(5))
        .await;
    assert_eq!(snapshot_len(&fixture).await, None);
    fixture.ctx.chat.chat_manager.dispose();
}
