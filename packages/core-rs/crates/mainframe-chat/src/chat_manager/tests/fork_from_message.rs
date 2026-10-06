//! `ChatManager::fork_chat(.., ForkPoint::BeforeMessage(id))` — the
//! from-message fork (`docs/specs/2026-10-06-fork-from-message.md`). A child
//! module of `tests`, so it sees `tests`' private `StoreDeps`; `StoreDeps`
//! records each `ForkPinRequest` and echoes a cut back as the pinned turn.

use super::*;
use mainframe_adapter_api::ForkCut;

fn parent() -> Chat {
    // `enrich_chat` stats StoreDeps's fixed project path; keep it present so
    // these tests are about the fork rules, not directory presence.
    std::fs::create_dir_all("/tmp/test").expect("create the fake project dir");
    let mut c = test_chat("c1");
    c.adapter_id = "claude".to_string();
    c.claude_session_id = Some("sess-1".to_string());
    c.status = ChatStatus::Active;
    c
}

fn message(id: &str, r#type: ChatMessageType) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: "c1".to_string(),
        r#type,
        content: Vec::new(),
        timestamp: "2026-10-06T00:00:00.000Z".to_string(),
        metadata: None,
    }
}

/// Three user turns, each answered: `<prefix>1`, `<prefix>1-reply`, ...
fn turns(prefix: &str) -> Vec<ChatMessage> {
    (1..=3)
        .flat_map(|n| {
            [
                message(&format!("{prefix}{n}"), ChatMessageType::User),
                message(&format!("{prefix}{n}-reply"), ChatMessageType::Assistant),
            ]
        })
        .collect()
}

fn setup(chat: Chat) -> (Arc<StoreDeps>, ChatManager) {
    let deps = StoreDeps::with_chats(vec![chat]);
    deps.set_fork_capable(true);
    deps.set_history(turns("u"));
    let mgr = ChatManager::new(deps.clone());
    (deps, mgr)
}

/// What the chat shows, when it differs from what the adapter reloads.
fn show_live(mgr: &ChatManager, live: Vec<ChatMessage>) {
    let mut cache = mgr.messages.lock().unwrap();
    for m in live {
        cache.append("c1", m);
    }
}

fn before(id: &str) -> ForkPoint {
    ForkPoint::BeforeMessage(id.to_string())
}

fn pinned_cut(deps: &StoreDeps) -> Option<ForkCut> {
    deps.pin_requests().last().and_then(|r| r.cut.clone())
}

#[tokio::test]
async fn success_links_the_parent_and_pins_the_resolved_cut() {
    let (deps, mgr) = setup(parent());
    let fork = mgr.fork_chat("c1", before("u2")).await.expect("fork");
    assert_eq!(fork.parent_chat_id, Some(Some("c1".to_string())));
    assert_eq!(
        pinned_cut(&deps),
        Some(ForkCut {
            vendor_message_id: "u2".to_string()
        })
    );
}

#[tokio::test]
async fn live_ids_unknown_to_the_transcript_resolve_by_ordinal() {
    let (deps, mgr) = setup(parent());
    show_live(&mgr, turns("live-"));
    mgr.fork_chat("c1", before("live-3")).await.expect("fork");
    assert_eq!(
        pinned_cut(&deps).map(|c| c.vendor_message_id),
        Some("u3".to_string())
    );
}

#[tokio::test]
async fn the_whole_chat_fork_sends_no_cut() {
    let (deps, mgr) = setup(parent());
    mgr.fork_chat("c1", ForkPoint::Current).await.expect("fork");
    assert_eq!(deps.pin_requests().len(), 1);
    assert_eq!(pinned_cut(&deps), None);
}

/// Every refusal row of the contract table: the right error, and no new chat.
#[tokio::test]
async fn each_refusal_maps_to_its_status_and_creates_no_chat() {
    let mut queued = message("u4", ChatMessageType::User);
    queued.metadata = Some(HashMap::from([(
        "queued".to_string(),
        serde_json::json!(true),
    )]));
    let cases: Vec<(&str, Vec<ChatMessage>, ForkChatError, u16)> = vec![
        ("nope", Vec::new(), ForkChatError::MessageNotFound, 404),
        ("u2-reply", Vec::new(), ForkChatError::NotAUserMessage, 400),
        ("u1", Vec::new(), ForkChatError::NothingBeforeMessage, 409),
        ("u4", vec![queued], ForkChatError::MessageNotSent, 409),
    ];
    for (id, extra_live, expected, status) in cases {
        let (deps, mgr) = setup(parent());
        if !extra_live.is_empty() {
            let mut live = turns("u");
            live.extend(extra_live);
            show_live(&mgr, live);
        }
        let before_count = deps.chat_count();
        let err = mgr.fork_chat("c1", before(id)).await.unwrap_err();
        assert_eq!(err, expected, "{id}");
        assert_eq!(err.status_code(), status, "{id}");
        assert_eq!(deps.chat_count(), before_count, "{id}");
        assert!(deps.pin_requests().is_empty(), "{id}: nothing is pinned");
    }
}

#[tokio::test]
async fn a_transcript_that_disagrees_with_the_chat_is_unresolved() {
    let (deps, mgr) = setup(parent());
    let mut live = turns("live-");
    live.push(message("live-4", ChatMessageType::User));
    show_live(&mgr, live);
    let err = mgr.fork_chat("c1", before("live-2")).await.unwrap_err();
    assert!(matches!(err, ForkChatError::ForkPointUnresolved(_)));
    assert_eq!(err.status_code(), 409);
    assert!(deps.pin_requests().is_empty());
}

#[tokio::test]
async fn the_adapters_point_not_found_reason_is_a_409_and_creates_no_chat() {
    let (deps, mgr) = setup(parent());
    deps.fail_pin_point_not_found("This message joined a turn that was already running");
    let before_count = deps.chat_count();
    let err = mgr.fork_chat("c1", before("u2")).await.unwrap_err();
    assert_eq!(
        err,
        ForkChatError::ForkPointUnresolved(
            "This message joined a turn that was already running".to_string()
        )
    );
    assert_eq!(err.status_code(), 409);
    assert_eq!(deps.chat_count(), before_count);
}

/// Everything before a sent message is settled, so a running turn doesn't
/// block the from-message fork — it still blocks the whole-chat one.
#[tokio::test]
async fn a_turn_in_flight_is_allowed_from_a_message_but_not_for_the_whole_chat() {
    let mut running = parent();
    running.process_state = Some(Some(ProcessState::Working));
    let (_deps, mgr) = setup(running);
    assert_eq!(
        mgr.fork_chat("c1", ForkPoint::Current).await.unwrap_err(),
        ForkChatError::TurnInFlight
    );
    assert!(mgr.fork_chat("c1", before("u3")).await.is_ok());
}

/// The cut is fully encoded in what the pin returned, so a daemon restart
/// before the fork's first send still resumes at the pinned point.
#[tokio::test]
async fn after_a_restart_the_pending_fork_still_resumes_the_pinned_point() {
    let (deps, mgr) = setup(parent());
    let fork = mgr.fork_chat("c1", before("u2")).await.expect("fork");
    drop(mgr);

    let restarted = ChatManager::new(deps.clone());
    let pending = deps.get_pending_fork(&fork.id).expect("pending fork kept");
    assert_eq!(pending.fork_source.last_turn_id.as_deref(), Some("u2"));

    restarted.get_messages(&fork.id).await;
    let resumed_from = deps
        .created_sessions()
        .last()
        .and_then(|o| o.fork_source.clone())
        .and_then(|s| s.last_turn_id);
    assert_eq!(resumed_from.as_deref(), Some("u2"));
}
