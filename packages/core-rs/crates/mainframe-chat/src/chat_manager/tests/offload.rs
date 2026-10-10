//! Idle whole-chat offload, AC1-7: a real `ChatManager` wires the
//! real `ChatOffload` end to end via `scan_idle_sessions` (which builds one
//! from the manager's own shared state, matching production wiring), so these
//! tests exercise the same registry/cache/event path production code takes.
//!
//! No fake clock is needed: a `FakeSession.activity` this suite sets once, at
//! construction, several hours in the PAST relative to the real wall clock,
//! is idle past the real 2-hour `IDLE_THRESHOLD_MS` for the lifetime of the
//! test — there is no reason to inject time.

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
fn offloader_for(
    mgr: &ChatManager,
) -> ChatOffload<crate::chat_manager::deps_lifecycle::LcDeps, crate::chat_manager::deps_event::EhDeps>
{
    ChatOffload::new(
        mgr.active_chats.clone(),
        mgr.permissions.clone(),
        mgr.queued_refs.clone(),
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
    mgr.worktree_offers.seed_pending_for_test("c1", "/tmp/wt");

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

/// "Chat on screen when offloaded" edge case: offload leaves an attached
/// facade session untouched (no `ChatEnded`), so it still holds the
/// pre-offload items under their OLD ids. Sending from that same screen
/// respawns and reloads the transcript (AC7), rebuilding the cache — the
/// reload must tell the attached session to `Resync` so it re-replays
/// against the reloaded graph instead of diffing old ids against new ones,
/// which would clear every earlier item by id and push it to the end,
/// scrambling the on-screen order ( review finding).
#[tokio::test]
async fn resend_from_an_attached_chat_after_offload_resyncs_instead_of_scrambling_order() {
    let (deps, mgr) =
        seed_offloadable_chat_with_transcript(vec![history_message("m1"), history_message("m2")]);
    let surface = RecordingSurface::arc();
    let mgr = mgr.with_chat_surface(surface.clone());
    deps.set_spawn_ok(true);

    mgr.scan_idle_sessions().await;
    assert!(
        mgr.messages.lock().unwrap().get("c1").is_none(),
        "offloaded: no cached messages"
    );
    assert!(
        !surface
            .events()
            .iter()
            .any(|e| matches!(e, ChatSurfaceEvent::ChatEnded { .. })),
        "offload must not tell an attached session the chat ended"
    );

    // The same "on-screen" facade session is still attached; sending now
    // resumes and reloads the transcript under it (AC7's resume path).
    mgr.send_message("c1", "hello again", None, None)
        .await
        .expect("the resumed session now spawns successfully");

    assert!(
        surface
            .events()
            .iter()
            .any(|e| matches!(e, ChatSurfaceEvent::Resync { chat_id } if chat_id == "c1")),
        "reloading a chat with an attached session must resync it, \
         not leave it diffing stale live ids against the reloaded graph"
    );
}

// ── R1: offload guard, resync producers ──────────────────────────

/// Finding 4: `ChatOffload::recheck` must not kill the CLI of a turn whose
/// tool is still running silently past the idle threshold — `is_spawned`/
/// `last_activity_at` alone can't see that.
#[tokio::test]
async fn a_working_chat_is_never_offloaded() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let mut chat = test_chat("c1");
    chat.process_state = Some(Some(mainframe_types::chat::ProcessState::Working));
    let session = FakeSession::with_activity(true, Some(long_idle()));
    seed_active(&mgr, "c1", chat, session.clone());
    mgr.messages
        .lock()
        .unwrap()
        .set("c1", vec![history_message("m1")]);

    mgr.scan_idle_sessions().await;

    assert_eq!(session.kills(), 0, "a working turn's CLI is never killed");
    assert!(
        mgr.active_chats.get("c1").is_some(),
        "the registry cell remains"
    );
    assert!(
        mgr.messages.lock().unwrap().get("c1").is_some(),
        "the cache remains"
    );
    assert!(offloaded_events(&deps).is_empty());
}

/// Finding 6: a cold chat's first send after `session/resume` must not force
/// a full replay — `do_load_chat`'s reload reproduces the exact same list
/// `get_messages` already cached, so no resync is warranted.
#[tokio::test]
async fn a_cold_opened_chat_sends_without_resync() {
    let mut chat = test_chat("c1");
    chat.claude_session_id = Some("sess-1".to_string());
    let deps = StoreDeps::with_chats(vec![chat]);
    *deps.history.lock().unwrap() = Some(vec![history_message("m1"), history_message("m2")]);
    deps.set_spawn_ok(true);
    let mgr = ChatManager::new(deps.clone());
    let surface = RecordingSurface::arc();
    let mgr = mgr.with_chat_surface(surface.clone());

    let _ = mgr.get_messages("c1").await;
    mgr.send_message("c1", "hello", None, None)
        .await
        .expect("the cold chat spawns and sends");

    assert!(
        !surface
            .events()
            .iter()
            .any(|e| matches!(e, ChatSurfaceEvent::Resync { .. })),
        "an identical reload of an already-warm cache must not resync"
    );
}

/// Finding 5: `emit_worktree_missing_error` loads any existing history before
/// it appends, so the error lands after the chat's prior transcript instead
/// of replacing it.
#[tokio::test]
async fn worktree_missing_error_keeps_the_loaded_history() {
    let mut chat = test_chat("c1");
    chat.claude_session_id = Some("sess-1".to_string());
    // `get_chat` recomputes `worktree_missing` from disk (`enrich_chat`), so
    // the fixture needs a worktree path that is actually absent rather than
    // the flag set directly.
    chat.worktree_path = Some("/tmp/mainframe-test-missing-worktree-r1".to_string());
    let deps = StoreDeps::with_chats(vec![chat]);
    *deps.history.lock().unwrap() = Some(vec![history_message("m1"), history_message("m2")]);
    let mgr = ChatManager::new(deps.clone());

    mgr.send_message("c1", "hello", None, None)
        .await
        .expect("the worktree-missing branch returns Ok without sending");

    let messages = mgr.get_messages("c1").await;
    assert_eq!(messages.len(), 3, "history plus one error message");
    let ids: Vec<&str> = messages[..2].iter().map(|m| m.id.as_str()).collect();
    assert_eq!(
        ids,
        vec!["m1", "m2"],
        "the loaded history survives, with the error appended after it"
    );
    assert_eq!(messages[2].r#type, ChatMessageType::Error);
}

// ──: idle offload for unspawned registry cells ──────────────────
//
// `ActiveChat::new` (every production insertion point) and `touch` (every use
// path) stamp `last_used_at` with the real clock, so these tests — like the
// AC1-7 suite above — need no injected fake clock: a cell is backdated once,
// directly, past the real `IDLE_THRESHOLD_MS`, and stays idle for the test's
// lifetime unless something re-touches it.

/// Insert `chat_id` with an explicit `session` (any spawn state, or `None`
/// for a cell that never spawned at all) and an explicit backdated
/// `last_used_at` — deliberately bypassing the fresh-clock stamp
/// `ActiveChat::new` normally applies, the same way `seed_idle_chat` bypasses
/// a spawned session's real `last_activity_at` by injecting it directly.
fn seed_cell(
    mgr: &ChatManager,
    chat_id: &str,
    chat: Chat,
    session: Option<Arc<dyn AdapterSession>>,
    last_used_at: i64,
) {
    let mut active = ActiveChat::new(chat, session);
    active.last_used_at = last_used_at;
    mgr.active_chats
        .insert(chat_id.to_string(), Arc::new(Mutex::new(active)));
}

fn minimal_new_chat() -> NewChat {
    NewChat {
        project_id: "p1".to_string(),
        adapter_id: "claude".to_string(),
        model: None,
        permission_mode: None,
        automation_run_id: None,
        temporary: false,
        scratch_root: None,
    }
}

/// (a) A never-sent chat (`create_chat`, no session ever attached) backdated
/// past the threshold is offloaded: the cell, cache entry and pin are gone,
/// but the chat row survives, unarchived.
#[tokio::test]
async fn unspawned_never_sent_cell_offloads_once_backdated_past_the_threshold() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let chat = mgr.create_chat(minimal_new_chat()).await;
    mgr.messages
        .lock()
        .unwrap()
        .set(&chat.id, vec![history_message("m1")]);
    {
        let cell = mgr.active_chats.get(&chat.id).unwrap().value().clone();
        cell.lock().unwrap().last_used_at = long_idle();
    }

    mgr.scan_idle_sessions().await;

    assert!(
        mgr.active_chats.get(&chat.id).is_none(),
        "the registry cell is gone"
    );
    assert!(
        mgr.messages.lock().unwrap().get(&chat.id).is_none(),
        "the cache entry is gone"
    );
    assert!(
        !mgr.messages.lock().unwrap().is_pinned(&chat.id),
        "the pin is released"
    );
    let stored = deps.chats_get(&chat.id).expect("the chat row survives");
    assert_ne!(stored.status, ChatStatus::Archived, "not archived");
    assert_eq!(offloaded_events(&deps), vec![chat.id.clone()]);
}

/// (b) A REST-resume-style cell: an unspawned `FakeSession` handle (a failed
/// spawn, or a resume that never started) plus a transcript already cached.
/// Backdated and offloaded, a send then succeeds and reloads the exact
/// pre-offload history under its stable ids, followed by the new message —
/// the AC7 pattern, for a cell that never had a live process to begin with.
#[tokio::test]
async fn unspawned_session_handle_offloads_and_a_later_send_resumes_cleanly() {
    let mut chat = test_chat("c1");
    chat.claude_session_id = Some("sess-1".to_string());
    let history = vec![history_message("m1"), history_message("m2")];
    let deps = StoreDeps::with_chats(vec![chat.clone()]);
    *deps.history.lock().unwrap() = Some(history.clone());
    deps.set_spawn_ok(true);
    let mgr = ChatManager::new(deps.clone());
    let session: Arc<dyn AdapterSession> = FakeSession::with_activity(false, None);
    seed_cell(&mgr, "c1", chat, Some(session), long_idle());
    mgr.messages.lock().unwrap().set("c1", history);

    mgr.scan_idle_sessions().await;
    assert!(
        mgr.active_chats.get("c1").is_none(),
        "offloaded: no registry cell"
    );
    assert!(
        mgr.messages.lock().unwrap().get("c1").is_none(),
        "offloaded: no cached messages"
    );
    assert_eq!(offloaded_events(&deps), vec!["c1".to_string()]);

    mgr.send_message("c1", "hello again", None, None)
        .await
        .expect("the resumed session now spawns successfully");

    assert!(
        mgr.active_chats.get("c1").is_some(),
        "the resume path re-registered the chat"
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
}

/// (c) A freshly created or freshly loaded chat is not offloaded by a scan —
/// the fresh `last_used_at` an insertion stamps keeps it live.
#[tokio::test]
async fn a_freshly_created_chat_is_not_offloaded_by_a_scan() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let chat = mgr.create_chat(minimal_new_chat()).await;

    mgr.scan_idle_sessions().await;

    assert!(
        mgr.active_chats.get(&chat.id).is_some(),
        "a fresh last_used_at keeps it live"
    );
    assert!(offloaded_events(&deps).is_empty());
}

#[tokio::test]
async fn a_freshly_loaded_chat_is_not_offloaded_by_a_scan() {
    let chat = test_chat("c1");
    let deps = StoreDeps::with_chats(vec![chat]);
    *deps.history.lock().unwrap() = Some(Vec::new());
    let mgr = ChatManager::new(deps.clone());

    mgr.load_chat("c1").await;
    mgr.scan_idle_sessions().await;

    assert!(mgr.active_chats.get("c1").is_some());
    assert!(offloaded_events(&deps).is_empty());
}

// ── races: selection vs. offload, on an unspawned cell ──────────

/// A send registered after selection (but before the offload's re-check)
/// keeps an unspawned, backdated cell live — `try_claim_offload`'s busy check
/// refuses the claim outright, same as the spawned-session AC4 case.
#[tokio::test]
async fn an_in_flight_send_injected_after_selection_keeps_an_unspawned_cell_live() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    seed_cell(&mgr, "c1", test_chat("c1"), None, long_idle());
    mgr.messages
        .lock()
        .unwrap()
        .set("c1", vec![history_message("m1")]);

    let candidates = select_idle_candidates(&mgr.active_chats, now_ms(), IDLE_THRESHOLD_MS);
    assert_eq!(
        candidates,
        vec!["c1".to_string()],
        "selected before the race"
    );

    let send_guard = mgr.lifecycle.begin_send("c1").await;

    mgr.scan_idle_sessions().await;

    assert!(mgr.active_chats.get("c1").is_some(), "the chat stays live");
    assert!(offloaded_events(&deps).is_empty());
    drop(send_guard);
}

/// A touch (e.g. a claim-free config read) landing after selection but before
/// the offload's re-check keeps an unspawned cell live — `idle_since` reads
/// the bumped `last_used_at`, so `recheck` no longer sees it as idle. Driven
/// directly via `offloader_for`, same reasoning as the spawned-session
/// activity-race test: `scan_idle_sessions`'s own fresh selection would
/// otherwise just re-filter the candidate out before `recheck` ever ran.
#[tokio::test]
async fn a_touch_injected_after_selection_keeps_an_unspawned_cell_live() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    seed_cell(&mgr, "c1", test_chat("c1"), None, long_idle());
    mgr.messages
        .lock()
        .unwrap()
        .set("c1", vec![history_message("m1")]);

    let candidates = select_idle_candidates(&mgr.active_chats, now_ms(), IDLE_THRESHOLD_MS);
    assert_eq!(
        candidates,
        vec!["c1".to_string()],
        "selected before the race"
    );

    // The race: a touch lands after selection, before the offload re-check.
    mgr.lifecycle.touch("c1");

    let offloader = offloader_for(&mgr);
    offloader.offload("c1").await;

    assert!(mgr.active_chats.get("c1").is_some(), "the chat stays live");
    assert!(mgr.messages.lock().unwrap().get("c1").is_some());
    assert!(offloaded_events(&deps).is_empty());
}

// ──: pending/queued/Working still block an unspawned cell ───────

#[tokio::test]
async fn a_pending_permission_blocks_offload_of_an_unspawned_backdated_cell() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    seed_cell(&mgr, "c1", test_chat("c1"), None, long_idle());
    mgr.messages
        .lock()
        .unwrap()
        .set("c1", vec![history_message("m1")]);
    enqueue_pending_permission(&mgr);

    mgr.scan_idle_sessions().await;

    assert!(mgr.active_chats.get("c1").is_some(), "stays live");
    assert!(offloaded_events(&deps).is_empty());
}

#[tokio::test]
async fn a_queued_message_blocks_offload_of_an_unspawned_backdated_cell() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    seed_cell(&mgr, "c1", test_chat("c1"), None, long_idle());
    mgr.messages
        .lock()
        .unwrap()
        .set("c1", vec![history_message("m1")]);
    mgr.queued_refs.lock().unwrap().push(QueuedMessageRef {
        message_id: "m1".to_string(),
        chat_id: "c1".to_string(),
        uuid: "u1".to_string(),
        content: "queued".to_string(),
        attachment_ids: None,
        timestamp: String::new(),
    });

    mgr.scan_idle_sessions().await;

    assert!(mgr.active_chats.get("c1").is_some(), "stays live");
    assert!(offloaded_events(&deps).is_empty());
}

#[tokio::test]
async fn a_working_process_state_blocks_offload_of_an_unspawned_backdated_cell() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let mut chat = test_chat("c1");
    chat.process_state = Some(Some(ProcessState::Working));
    seed_cell(&mgr, "c1", chat, None, long_idle());
    mgr.messages
        .lock()
        .unwrap()
        .set("c1", vec![history_message("m1")]);

    mgr.scan_idle_sessions().await;

    assert!(mgr.active_chats.get("c1").is_some(), "stays live");
    assert!(offloaded_events(&deps).is_empty());
}

// ──: config entry points rebuild an offloaded cell ──────────────

#[tokio::test]
async fn update_chat_config_rebuilds_an_offloaded_cell_and_applies_the_new_model() {
    let mut chat = test_chat("c1");
    chat.model = Some("old-model".to_string());
    let deps = StoreDeps::with_chats(vec![chat.clone()]);
    *deps.history.lock().unwrap() = Some(Vec::new());
    let mgr = ChatManager::new(deps.clone());
    seed_cell(&mgr, "c1", chat, None, long_idle());
    mgr.messages
        .lock()
        .unwrap()
        .set("c1", vec![history_message("m1")]);

    mgr.scan_idle_sessions().await;
    assert!(
        mgr.active_chats.get("c1").is_none(),
        "offloaded before the config edit"
    );

    mgr.update_chat_config("c1", None, Some("new-model".to_string()), None, None)
        .await
        .expect("the edit rebuilds the cell instead of failing not-found");

    assert!(mgr.active_chats.get("c1").is_some(), "the cell is back");
    assert_eq!(
        deps.chats_get("c1").unwrap().model,
        Some("new-model".to_string()),
        "the stored chat carries the new model"
    );
    let active_model = mgr
        .active_chats
        .get("c1")
        .unwrap()
        .value()
        .lock()
        .unwrap()
        .chat
        .model
        .clone();
    assert_eq!(
        active_model,
        Some("new-model".to_string()),
        "the rebuilt active chat carries the new model too"
    );
}

#[tokio::test]
async fn disable_worktree_rebuilds_an_offloaded_cell_and_clears_the_binding() {
    let mut chat = test_chat("c1");
    chat.worktree_path = Some("/tmp/mainframe-test-todo-381-wt".to_string());
    chat.branch_name = Some("feat/old".to_string());
    let deps = StoreDeps::with_chats(vec![chat.clone()]);
    *deps.history.lock().unwrap() = Some(Vec::new());
    let mgr = ChatManager::new(deps.clone());
    seed_cell(&mgr, "c1", chat, None, long_idle());
    mgr.messages
        .lock()
        .unwrap()
        .set("c1", vec![history_message("m1")]);

    mgr.scan_idle_sessions().await;
    assert!(
        mgr.active_chats.get("c1").is_none(),
        "offloaded before the worktree edit"
    );

    mgr.disable_worktree("c1")
        .await
        .expect("the edit rebuilds the cell instead of silently no-oping");

    assert!(mgr.active_chats.get("c1").is_some(), "the cell is back");
    assert_eq!(
        deps.chats_get("c1").unwrap().worktree_path,
        None,
        "the stored binding is cleared"
    );
    let active_worktree = mgr
        .active_chats
        .get("c1")
        .unwrap()
        .value()
        .lock()
        .unwrap()
        .chat
        .worktree_path
        .clone();
    assert_eq!(
        active_worktree, None,
        "the rebuilt active chat's binding is cleared too"
    );
}
