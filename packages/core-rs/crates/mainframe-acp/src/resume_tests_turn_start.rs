use super::*;
use mainframe_types::acp::update::RunningStateUpdate;

const STARTED_AT: i64 = 1_700_000_042_000;

fn running_port(started_at_ms: Option<i64>) -> FakePort {
    FakePort {
        messages: vec![dmsg("dmsg_1", vec![text("hello")])],
        running: true,
        started_at_ms,
        ..FakePort::default()
    }
}

fn last_running(replay: &ResumeReplay) -> RunningStateUpdate {
    match replay.updates.last() {
        Some(SessionUpdate::StateUpdate(WireSessionState::Running(running))) => running.clone(),
        other => panic!("expected a closing running update, got {other:?}"),
    }
}

#[tokio::test]
async fn full_replay_while_running_carries_the_recorded_start() {
    let port = running_port(Some(STARTED_AT));
    let (_response, replay) = dispatch_resume(resume_request(None), &port, None).await;
    assert_eq!(last_running(&replay).started_at_ms(), Some(STARTED_AT));
}

#[tokio::test]
async fn cursor_replay_while_running_carries_the_recorded_start() {
    let port = running_port(Some(STARTED_AT));
    let cursor = json!({ "type": "item", "itemId": "dmsg_1" });
    let (_response, replay) = dispatch_resume(resume_request(Some(cursor)), &port, None).await;
    assert_eq!(last_running(&replay).started_at_ms(), Some(STARTED_AT));
}

#[tokio::test]
async fn windowed_replay_while_running_carries_the_recorded_start() {
    let port = running_port(Some(STARTED_AT));
    let log = Mutex::new(RevisionLog::new("epoch".into()));
    let boundary = log.lock().unwrap().boundary();
    let (_response, replay) = dispatch_resume_with(
        resume_request(Some(json!({ "type": "start" }))),
        &port,
        Some((&log, boundary)),
        ResumeOptions {
            windowed_history: true,
            result_previews: false,
        },
    )
    .await;
    assert_eq!(last_running(&replay).started_at_ms(), Some(STARTED_AT));
}

#[tokio::test]
async fn concurrent_resumes_of_one_turn_carry_the_identical_start() {
    let port = running_port(Some(STARTED_AT));
    let (first, second) = tokio::join!(
        dispatch_resume(resume_request(None), &port, None),
        dispatch_resume(resume_request(None), &port, None),
    );
    assert_eq!(first.1.updates.last(), second.1.updates.last());
    assert_eq!(last_running(&first.1).started_at_ms(), Some(STARTED_AT));
}

#[tokio::test]
async fn running_without_a_known_start_omits_meta() {
    let port = running_port(None);
    let (_response, replay) = dispatch_resume(resume_request(None), &port, None).await;
    assert_eq!(last_running(&replay).meta, None);
}

#[tokio::test]
async fn idle_replay_never_carries_a_start() {
    let port = FakePort {
        running: false,
        started_at_ms: Some(STARTED_AT),
        ..running_port(None)
    };
    let (_response, replay) = dispatch_resume(resume_request(None), &port, None).await;
    assert!(matches!(
        replay.updates.last(),
        Some(SessionUpdate::StateUpdate(WireSessionState::Idle(idle))) if idle.meta.is_none()
    ));
}
