//! Idle whole-chat offload (todo #178), AC1-7: a real `ChatManager` wires the
//! real `ChatOffload` end to end via `scan_idle_sessions` (which builds one
//! from the manager's own shared state, matching production wiring), so these
//! tests exercise the same registry/cache/event path production code takes.
//!
//! No fake clock is needed: a `FakeSession.activity` this suite sets once, at
//! construction, several hours in the PAST relative to the real wall clock,
//! is idle past the real 2-hour `IDLE_THRESHOLD_MS` for the lifetime of the
//! test — there is no reason to inject time.

use super::*;
use crate::idle_offload::ChatOffload;
use crate::idle_scanner::{IDLE_THRESHOLD_MS, IdleOffloader, select_idle_candidates};
use crate::test_support::FakeSession;
use mainframe_types::adapter::ControlRequest;
use mainframe_types::chat::{ChatMessage, ChatMessageType};
use mainframe_types::content::LeafContent;

/// Builds a `ChatOffload` from `mgr`'s own shared collaborators — exactly how
/// `ChatManager::scan_idle_sessions` builds one for the scanner (todo #178
/// plan "Design"). Lets a test drive `IdleOffloader::offload` on a SPECIFIC,
/// already-selected chat id directly, bypassing `scan_idle_sessions`'s own
/// fresh `select_idle_candidates` pass — necessary for a race test where the
/// state change happens strictly between selection and the offload itself:
/// `scan_idle_sessions`'s own selection would otherwise re-filter the
/// candidate out before `ChatOffload::recheck` ever ran (AC4).
fn offloader_for(
    mgr: &ChatManager,
) -> ChatOffload<crate::chat_manager::deps_lifecycle::LcDeps, crate::chat_manager::deps_event::EhDeps>
{
    ChatOffload::new(
        mgr.active_chats.clone(),
        mgr.messages.clone(),
        mgr.permissions.clone(),
        mgr.queued_refs.clone(),
        mgr.lifecycle.clone(),
        mgr.event_handler.clone(),
    )
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn long_idle() -> i64 {
    now_ms() - IDLE_THRESHOLD_MS - 5_000
}

/// A `ChatMessage` with a caller-chosen, stable id (mirrors a transcript
/// item's uuid) — lets a test assert id stability across an offload +
/// transcript reload without depending on `nanoid`'s randomness.
fn history_message(id: &str) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: "c1".to_string(),
        r#type: ChatMessageType::User,
        content: vec![MessageContent::Leaf(LeafContent::Text {
            text: id.to_string(),
            parent_tool_use_id: None,
        })],
        timestamp: mainframe_runtime::time::now_iso8601(),
        metadata: None,
    }
}

fn offloaded_events(deps: &StoreDeps) -> Vec<String> {
    deps.events()
        .into_iter()
        .filter_map(|e| match e {
            DaemonEvent::ChatOffloaded { chat_id } => Some(chat_id),
            _ => None,
        })
        .collect()
}

/// Seed "c1" as a spawned, live chat with `activity` as its last-activity
/// time and one cached history message — the common starting point for every
/// AC1-5 test below.
fn seed_idle_chat(mgr: &ChatManager, activity: Option<i64>) -> Arc<FakeSession> {
    let session = FakeSession::with_activity(true, activity);
    seed_active(mgr, "c1", test_chat("c1"), session.clone());
    mgr.messages
        .lock()
        .unwrap()
        .set("c1", vec![history_message("m1")]);
    session
}

/// AC6/AC7 setup: "c1" has a stored `claude_session_id` (the resume anchor)
/// and a transcript on disk (`deps.history`) matching what is already cached,
/// so an idle scan has something real to reload once it clears the cache.
/// Returns `(deps, mgr)` with the chat already idle past the threshold and
/// offloadable.
fn seed_offloadable_chat_with_transcript(
    history: Vec<ChatMessage>,
) -> (Arc<StoreDeps>, ChatManager) {
    let mut chat = test_chat("c1");
    chat.claude_session_id = Some("sess-1".to_string());
    let deps = StoreDeps::with_chats(vec![chat.clone()]);
    *deps.history.lock().unwrap() = Some(history.clone());
    let mgr = ChatManager::new(deps.clone());
    let session = FakeSession::with_activity(true, Some(long_idle()));
    seed_active(&mgr, "c1", chat, session);
    mgr.messages.lock().unwrap().set("c1", history);
    (deps, mgr)
}

/// The real enqueue path (`permission_manager::enqueue`) for "c1", via the
/// session sink's `on_permission` — not a direct internals poke.
fn enqueue_pending_permission(mgr: &ChatManager) {
    let sink = mgr.event_handler.build_sink("c1", None);
    sink.on_permission(ControlRequest {
        request_id: "req_1".to_string(),
        tool_name: "Bash".to_string(),
        tool_use_id: "toolu_1".to_string(),
        input: std::collections::HashMap::new(),
        suggestions: Vec::new(),
        decision_reason: None,
        options: None,
    });
}

// ── AC1 ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn ac1_offloads_a_chat_idle_past_the_threshold() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = seed_idle_chat(&mgr, Some(long_idle()));

    mgr.scan_idle_sessions().await;

    assert_eq!(session.kills(), 1, "the idle CLI process is killed");
    assert!(
        mgr.messages.lock().unwrap().get("c1").is_none(),
        "the cached history is dropped"
    );
    assert!(
        mgr.active_chats.get("c1").is_none(),
        "the chat leaves the live-chat registry"
    );
    assert_eq!(offloaded_events(&deps), vec!["c1".to_string()]);
}

// ── AC2 ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn ac2_a_pending_permission_blocks_offload_even_at_8_hours_idle() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let eight_hours_ms = 8 * 60 * 60 * 1000;
    let session = seed_idle_chat(&mgr, Some(now_ms() - eight_hours_ms));
    enqueue_pending_permission(&mgr);

    mgr.scan_idle_sessions().await;

    assert_eq!(session.kills(), 0, "the process is not killed");
    assert!(
        mgr.messages.lock().unwrap().get("c1").is_some(),
        "the cache is intact"
    );
    assert!(
        mgr.active_chats.get("c1").is_some(),
        "the chat stays in the registry"
    );
    assert!(offloaded_events(&deps).is_empty(), "no event is emitted");
}

// ── AC3 ───────────────────────────────────────────────────────────────────

/// Three ineligible chats, in one test since each assertion block is
/// identical: idle less than the threshold, no spawned process, and a
/// session that reports no activity time at all.
#[tokio::test]
async fn ac3_ineligible_chats_are_untouched() {
    for (label, spawned, activity) in [
        ("idle less than the threshold", true, Some(now_ms() - 1_000)),
        ("no spawned process", false, Some(long_idle())),
        ("no activity time reported", true, None),
    ] {
        let deps = StoreDeps::arc();
        let mgr = ChatManager::new(deps.clone());
        let session = FakeSession::with_activity(spawned, activity);
        seed_active(&mgr, "c1", test_chat("c1"), session.clone());

        mgr.scan_idle_sessions().await;

        assert_eq!(session.kills(), 0, "{label}: not killed");
        assert!(mgr.active_chats.get("c1").is_some(), "{label}: stays live");
        assert!(offloaded_events(&deps).is_empty(), "{label}: no event");
    }
}

// ── AC4: state changes between candidate selection and the offload ─────────
// (the two scan steps are exposed separately, plan "Design", precisely for
// this: read `select_idle_candidates` for "selection already ran", mutate
// shared state, then either let `scan_idle_sessions`'s own fresh selection
// pass see the SAME registry so its offload re-check runs after that
// mutation (permission, send), or — for the activity case, which selection
// itself would re-filter — drive `ChatOffload::offload` directly on the
// already-selected id via `offloader_for` (module doc above). The remaining
// two AC4 conditions, an in-flight spawn/load, can't arise for a chat that's
// already an active, spawned idle candidate (`start_chat`/`load_chat` both
// skip claiming for exactly that state) — those are asserted directly at the
// guard level in `lifecycle_manager::flight_claims::tests`
// (`try_claim_offload_refuses_while_a_spawn_is_in_flight`/
// `..._a_load_is_in_flight`).

#[tokio::test]
async fn ac4_a_pending_permission_injected_after_selection_keeps_the_chat_live() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = seed_idle_chat(&mgr, Some(long_idle()));

    let candidates = select_idle_candidates(&mgr.active_chats, now_ms(), IDLE_THRESHOLD_MS);
    assert_eq!(
        candidates,
        vec!["c1".to_string()],
        "selected before the race"
    );

    // The race: a permission gate opens after selection, before the offload runs.
    enqueue_pending_permission(&mgr);

    mgr.scan_idle_sessions().await;

    assert_eq!(session.kills(), 0, "the chat stays live");
    assert!(mgr.messages.lock().unwrap().get("c1").is_some());
    assert!(offloaded_events(&deps).is_empty());
}

/// The activity case can't be exercised through `scan_idle_sessions()` like
/// the permission/send cases above: `select_idle_candidates` itself filters
/// on activity, so a bump landing before `scan_idle_sessions`'s OWN fresh
/// selection pass would just silently drop the candidate before `offload()`
/// is even called — never reaching `ChatOffload::recheck`'s activity check at
/// all. Driving `IdleOffloader::offload` directly on the pre-selected id
/// (`offloader_for`, module doc above) is what actually exercises `recheck`.
#[tokio::test]
async fn ac4_activity_injected_after_selection_keeps_the_chat_live() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = seed_idle_chat(&mgr, Some(long_idle()));

    let candidates = select_idle_candidates(&mgr.active_chats, now_ms(), IDLE_THRESHOLD_MS);
    assert_eq!(
        candidates,
        vec!["c1".to_string()],
        "selected before the race"
    );

    // The race: fresh activity lands after selection, before the offload's re-check.
    session.bump_activity(now_ms());

    let offloader = offloader_for(&mgr);
    offloader.offload("c1").await;

    assert_eq!(session.kills(), 0, "the chat stays live");
    assert!(mgr.messages.lock().unwrap().get("c1").is_some());
    assert!(mgr.active_chats.get("c1").is_some());
    assert!(offloaded_events(&deps).is_empty());
}

#[tokio::test]
async fn ac4_an_in_flight_send_injected_after_selection_keeps_the_chat_live() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = seed_idle_chat(&mgr, Some(long_idle()));

    let candidates = select_idle_candidates(&mgr.active_chats, now_ms(), IDLE_THRESHOLD_MS);
    assert_eq!(
        candidates,
        vec!["c1".to_string()],
        "selected before the race"
    );

    // The race: a send registers after selection, before the offload runs.
    let send_guard = mgr.lifecycle.begin_send("c1").await;

    mgr.scan_idle_sessions().await;

    assert_eq!(session.kills(), 0, "the chat stays live");
    assert!(mgr.messages.lock().unwrap().get("c1").is_some());
    assert!(offloaded_events(&deps).is_empty());
    drop(send_guard);
}

// ── AC5 ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn ac5_scanning_twice_offloads_once() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = seed_idle_chat(&mgr, Some(long_idle()));

    mgr.scan_idle_sessions().await;
    mgr.scan_idle_sessions().await;

    assert_eq!(session.kills(), 1, "the process is killed exactly once");
    assert_eq!(
        offloaded_events(&deps),
        vec!["c1".to_string()],
        "exactly one chat.offloaded event"
    );
}

// ── AC6 ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn ac6_display_history_survives_offload_and_loads_once_for_concurrent_readers() {
    let history = vec![history_message("m1"), history_message("m2")];
    let (deps, mgr) = seed_offloadable_chat_with_transcript(history.clone());

    mgr.scan_idle_sessions().await;
    assert!(
        mgr.messages.lock().unwrap().get("c1").is_none(),
        "offloaded: cache is empty"
    );

    let (a, b) = tokio::join!(mgr.get_messages("c1"), mgr.get_messages("c1"));

    let ids = |ms: &[ChatMessage]| -> Vec<String> { ms.iter().map(|m| m.id.clone()).collect() };
    let expected_ids = ids(&history);
    assert_eq!(a.len(), history.len());
    assert_eq!(
        ids(&a),
        expected_ids,
        "same stable item ids as before offload"
    );
    assert_eq!(ids(&b), expected_ids);
    assert_eq!(
        deps.history_loads.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "two concurrent readers, one transcript load"
    );
}

// ── AC7 ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn ac7_get_messages_after_offload_does_not_touch_the_registry() {
    let (_deps, mgr) = seed_offloadable_chat_with_transcript(vec![history_message("m1")]);

    mgr.scan_idle_sessions().await;
    let _ = mgr.get_messages("c1").await;

    assert!(
        mgr.active_chats.get("c1").is_none(),
        "reading history alone never spawns a CLI process"
    );
}

#[tokio::test]
async fn ac7_send_after_offload_reloads_prior_history_via_the_resume_path() {
    let (deps, mgr) =
        seed_offloadable_chat_with_transcript(vec![history_message("m1"), history_message("m2")]);
    // A real post-spawn send: without this, `require_live_session` fails
    // after `start_chat` and the send never reaches `store_user_message`,
    // which is exactly the assertion this test exists to make (AC7's "spawns
    // one... sending... starts with every pre-offload message, followed by
    // the new user message").
    deps.set_spawn_ok(true);

    mgr.scan_idle_sessions().await;
    assert!(
        mgr.active_chats.get("c1").is_none(),
        "offloaded: no registry cell"
    );
    assert!(
        mgr.messages.lock().unwrap().get("c1").is_none(),
        "offloaded: no cached messages"
    );

    // send -> start_chat -> do_start_chat (spawns with the resume anchor,
    // asserted below) -> load_chat -> do_load_chat reloads the transcript ->
    // dispatch stores the new user message on top.
    mgr.send_message("c1", "hello again", None, None)
        .await
        .expect("the resumed session now spawns successfully");

    assert!(
        mgr.active_chats.get("c1").is_some(),
        "the resume path re-registered the chat"
    );

    let resume_session = deps
        .created_sessions()
        .into_iter()
        .find(|o| o.mainframe_chat_id == "c1")
        .expect("do_start_chat must have created a session for c1");
    assert_eq!(
        resume_session.chat_id,
        Some("sess-1".to_string()),
        "spawns with the stored CLI session id (the resume path)"
    );

    let reloaded = mgr
        .messages
        .lock()
        .unwrap()
        .get("c1")
        .cloned()
        .unwrap_or_default();
    assert_eq!(
        reloaded.len(),
        3,
        "every pre-offload message, followed by the new user message"
    );
    let ids: Vec<&str> = reloaded.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(
        &ids[..2],
        ["m1", "m2"],
        "history starts with every pre-offload message"
    );
    assert_eq!(
        reloaded[2].r#type,
        ChatMessageType::User,
        "followed by the new user message"
    );
    assert!(
        reloaded[2]
            .content
            .iter()
            .any(|c| matches!(c, MessageContent::Leaf(LeafContent::Text { text, .. }) if text == "hello again")),
        "the new user message carries the text just sent"
    );

    assert_eq!(
        deps.history_loads.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "one resume, one transcript load"
    );
}
