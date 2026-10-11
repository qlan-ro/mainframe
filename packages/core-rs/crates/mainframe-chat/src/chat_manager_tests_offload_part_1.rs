use super::*;
use crate::chat_surface::{ChatSurface, ChatSurfaceEvent};
use crate::idle_offload::ChatOffload;
use crate::idle_scanner::{IDLE_THRESHOLD_MS, IdleOffloader, select_idle_candidates};
use crate::test_support::FakeSession;
use mainframe_types::adapter::ControlRequest;
use mainframe_types::chat::{ChatMessage, ChatMessageType};
use mainframe_types::content::LeafContent;

/// Records every `ChatSurfaceEvent` an attached facade session would see —
/// used to prove a reload after offload tells an on-screen chat's session to
/// `Resync` (the "chat on screen when offloaded" edge case).
#[derive(Default)]
struct RecordingSurface {
    events: Mutex<Vec<ChatSurfaceEvent>>,
}

impl RecordingSurface {
    fn arc() -> Arc<Self> {
        Arc::new(Self::default())
    }
    fn events(&self) -> Vec<ChatSurfaceEvent> {
        self.events.lock().unwrap().clone()
    }
}

impl ChatSurface for RecordingSurface {
    fn on_chat_surface_event(&self, event: ChatSurfaceEvent) {
        self.events.lock().unwrap().push(event);
    }
}

/// Builds a `ChatOffload` from `mgr`'s own shared collaborators — exactly how
/// `ChatManager::scan_idle_sessions` builds one for the scanner. Lets a test
/// drive `IdleOffloader::offload` on a specific,
/// already-selected chat id directly, bypassing `scan_idle_sessions`'s own
/// fresh `select_idle_candidates` pass — necessary for a race test where the
/// state change happens strictly between selection and the offload itself:
/// `scan_idle_sessions`'s own selection would otherwise re-filter the
/// candidate out before `ChatOffload::recheck` ever ran (AC4).
fn offloader_for(mgr: &ChatManager) -> ChatOffload {
    ChatOffload::new(
        mgr.shared.active_chats.clone(),
        mgr.shared.permissions.clone(),
        mgr.shared.queued_refs.clone(),
        mgr.lifecycle.clone(),
        mgr.teardown.clone(),
    )
}

use mainframe_types::time::now_ms;

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
        timestamp: mainframe_types::time::now_iso8601(),
        metadata: None,
    }
}

fn offloaded_events(deps: &FakeDeps) -> Vec<String> {
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
    mgr.shared
        .messages
        .lock()
        .unwrap()
        .set("c1", vec![history_message("m1")]);
    session
}

/// AC6/AC7 setup: "c1" has a stored `vendor_session_id` (the resume anchor)
/// and a transcript on disk (`deps.history`) matching what is already cached,
/// so an idle scan has something real to reload once it clears the cache.
/// Returns `(deps, mgr)` with the chat already idle past the threshold and
/// offloadable.
fn seed_offloadable_chat_with_transcript(
    history: Vec<ChatMessage>,
) -> (Arc<FakeDeps>, ChatManager) {
    let mut chat = test_chat("c1");
    chat.vendor_session_id = Some("sess-1".to_string());
    let deps = FakeDeps::with_chats(vec![chat.clone()]);
    *deps.adapters.history.lock().unwrap() = Some(history.clone());
    let mgr = ChatManager::new(deps.clone());
    let session = FakeSession::with_activity(true, Some(long_idle()));
    seed_active(&mgr, "c1", chat, session);
    mgr.shared.messages.lock().unwrap().set("c1", history);
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
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = seed_idle_chat(&mgr, Some(long_idle()));
    mgr.worktree_offers.seed_pending_for_test("c1", "/tmp/wt");

    mgr.scan_idle_sessions().await;

    assert_eq!(session.kills(), 1, "the idle CLI process is killed");
    assert!(
        mgr.shared.messages.lock().unwrap().get("c1").is_none(),
        "the cached history is dropped"
    );
    assert!(
        mgr.shared.active_chats.get("c1").is_none(),
        "the chat leaves the live-chat registry"
    );
    assert_eq!(
        mgr.worktree_offers_for_chat("c1").len(),
        1,
        "an offloaded chat keeps its worktree offers"
    );
    assert_eq!(offloaded_events(&deps), vec!["c1".to_string()]);
}

// ── AC2 ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn ac2_a_pending_permission_blocks_offload_even_at_8_hours_idle() {
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let eight_hours_ms = 8 * 60 * 60 * 1000;
    let session = seed_idle_chat(&mgr, Some(now_ms() - eight_hours_ms));
    enqueue_pending_permission(&mgr);

    mgr.scan_idle_sessions().await;

    assert_eq!(session.kills(), 0, "the process is not killed");
    assert!(
        mgr.shared.messages.lock().unwrap().get("c1").is_some(),
        "the cache is intact"
    );
    assert!(
        mgr.shared.active_chats.get("c1").is_some(),
        "the chat stays in the registry"
    );
    assert!(offloaded_events(&deps).is_empty(), "no event is emitted");
}

// ── AC3 ───────────────────────────────────────────────────────────────────

/// Three ineligible chats, in one test since each assertion block is
/// identical: idle less than the threshold, an unspawned session on a cell
/// whose `last_used_at` is still fresh (`seed_active`'s
/// `ActiveChat::new` stamps "now" — this now proves `last_used_at`, not
/// `is_spawned()`, is what keeps an unspawned cell live, not the old
/// "no spawned process ⇒ never a candidate" rule), and a session that reports
/// no activity time at all.
#[tokio::test]
async fn ac3_ineligible_chats_are_untouched() {
    for (label, spawned, activity) in [
        ("idle less than the threshold", true, Some(now_ms() - 1_000)),
        (
            "an unspawned session, but a fresh cell (todo #381)",
            false,
            Some(long_idle()),
        ),
        ("no activity time reported", true, None),
    ] {
        let deps = FakeDeps::arc();
        let mgr = ChatManager::new(deps.clone());
        let session = FakeSession::with_activity(spawned, activity);
        seed_active(&mgr, "c1", test_chat("c1"), session.clone());

        mgr.scan_idle_sessions().await;

        assert_eq!(session.kills(), 0, "{label}: not killed");
        assert!(
            mgr.shared.active_chats.get("c1").is_some(),
            "{label}: stays live"
        );
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
    let deps = FakeDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = seed_idle_chat(&mgr, Some(long_idle()));

    let candidates = select_idle_candidates(&mgr.shared.active_chats, now_ms(), IDLE_THRESHOLD_MS);
    assert_eq!(
        candidates,
        vec!["c1".to_string()],
        "selected before the race"
    );

    // The race: a permission gate opens after selection, before the offload runs.
    enqueue_pending_permission(&mgr);

    mgr.scan_idle_sessions().await;

    assert_eq!(session.kills(), 0, "the chat stays live");
    assert!(mgr.shared.messages.lock().unwrap().get("c1").is_some());
    assert!(offloaded_events(&deps).is_empty());
}
