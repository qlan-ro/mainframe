//! The idle history release end to end on a real `ChatManager`: the
//! production scanner, `ChatRelease`, the teardown, the lifecycle restore and
//! the chat-surface notice. Synthetic transcripts only.

use super::*;
use crate::chat_surface::{ChatSurface, ChatSurfaceEvent};
use crate::chat_viewers::ChatViewers;
use crate::idle_offload::ChatOffload;
use crate::idle_release::ChatRelease;
use crate::idle_scanner::{IDLE_THRESHOLD_MS, IdleSessionScanner};
use crate::test_support::FakeSession;
use mainframe_types::chat::{ChatMessage, ChatMessageType};
use mainframe_types::content::LeafContent;
use mainframe_types::settings_kv::SettingsKv as _;
use mainframe_types::time::now_ms;
use std::collections::HashSet;

const MINUTE: i64 = 60_000;

#[derive(Default)]
struct RecordingSurface {
    events: Mutex<Vec<ChatSurfaceEvent>>,
    /// When set, records whether the offload claim was free as each release
    /// notice arrived.
    probe: std::sync::OnceLock<Arc<crate::lifecycle_manager::ChatLifecycleManager>>,
    claim_free_at_notice: Mutex<Vec<bool>>,
}

impl RecordingSurface {
    fn released(&self) -> Vec<String> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                ChatSurfaceEvent::HistoryReleased { chat_id } => Some(chat_id.clone()),
                _ => None,
            })
            .collect()
    }
}

impl ChatSurface for RecordingSurface {
    fn on_chat_surface_event(&self, event: ChatSurfaceEvent) {
        if let (ChatSurfaceEvent::HistoryReleased { chat_id }, Some(lifecycle)) =
            (&event, self.probe.get())
        {
            let free = lifecycle.try_claim_offload(chat_id).is_some();
            self.claim_free_at_notice.lock().unwrap().push(free);
        }
        self.events.lock().unwrap().push(event);
    }
}

/// Chats on screen; `on_check` runs (once) inside the next viewer check.
#[derive(Default)]
struct Viewers(
    Mutex<HashSet<String>>,
    Mutex<Option<Box<dyn FnOnce() + Send>>>,
);

impl ChatViewers for Viewers {
    fn is_viewed(&self, chat_id: &str) -> bool {
        if let Some(on_check) = self.1.lock().unwrap().take() {
            on_check();
        }
        self.0.lock().unwrap().contains(chat_id)
    }
}

fn message(id: &str) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: "c1".to_string(),
        r#type: ChatMessageType::User,
        content: vec![MessageContent::Leaf(LeafContent::Text {
            text: "synthetic".to_string(),
            parent_tool_use_id: None,
        })],
        timestamp: mainframe_types::time::now_iso8601(),
        metadata: None,
    }
}

struct Fixture {
    deps: Arc<FakeDeps>,
    mgr: ChatManager,
    session: Arc<FakeSession>,
    surface: Arc<RecordingSurface>,
    viewers: Arc<Viewers>,
}

/// "c1": a cell last used `idle_ms` ago whose session never spawned (no
/// process alive), with a transcript on disk matching what the cache holds.
/// A send spawns a fresh CLI.
fn fixture_with(idle_ms: i64, edit: impl FnOnce(&mut Chat)) -> Fixture {
    let mut chat = test_chat("c1");
    chat.vendor_session_id = Some("sess-1".to_string());
    edit(&mut chat);
    let deps = FakeDeps::with_chats(vec![chat.clone()]);
    let history = vec![message("m1"), message("m2")];
    *deps.adapters.history.lock().unwrap() = Some(history.clone());
    deps.set_spawn_ok(true);
    let surface = Arc::new(RecordingSurface::default());
    let mgr = ChatManager::new(deps.clone()).with_chat_surface(surface.clone());
    mgr.dispose();
    let viewers = Arc::new(Viewers::default());
    mgr.attach_viewers(viewers.clone());
    let session = FakeSession::with_activity(false, Some(now_ms() - idle_ms));
    let mut active = ActiveChat::new(chat, Some(session.clone()));
    active.last_used_at = now_ms() - idle_ms;
    mgr.shared
        .active_chats
        .insert("c1".to_string(), Arc::new(Mutex::new(active)));
    let mut messages = mgr.shared.messages.lock().unwrap();
    messages.pin("c1");
    messages.set("c1", history);
    drop(messages);
    Fixture {
        deps,
        mgr,
        session,
        surface,
        viewers,
    }
}

fn fixture() -> Fixture {
    fixture_with(60 * MINUTE, |_| {})
}

/// One production scan pass: the real offloader, then the real releaser.
async fn scan(mgr: &ChatManager) {
    let offloader = Arc::new(ChatOffload::new(
        mgr.shared.active_chats.clone(),
        mgr.shared.permissions.clone(),
        mgr.shared.queued_refs.clone(),
        mgr.lifecycle.clone(),
        mgr.teardown.clone(),
    ));
    let releaser = Arc::new(ChatRelease::new(
        mgr.shared.clone(),
        mgr.lifecycle.clone(),
        mgr.teardown.clone(),
    ));
    IdleSessionScanner::with_config(
        mgr.shared.active_chats.clone(),
        offloader,
        IDLE_THRESHOLD_MS,
        60_000,
        Arc::new(now_ms),
    )
    .with_releaser(releaser)
    .scan()
    .await;
}

fn holds_history(mgr: &ChatManager) -> bool {
    mgr.shared.messages.lock().unwrap().get("c1").is_some()
}

fn cached_ids(mgr: &ChatManager) -> Vec<String> {
    mgr.shared
        .messages
        .lock()
        .unwrap()
        .get("c1")
        .map(|m| m.iter().map(|m| m.id.clone()).collect())
        .unwrap_or_default()
}

#[tokio::test]
async fn an_idle_chat_without_a_process_gives_up_its_history_but_keeps_its_cell() {
    let f = fixture();
    f.mgr.worktree_offers.seed_pending_for_test("c1", "/tmp/wt");
    let cell = f.mgr.shared.active("c1").unwrap();

    scan(&f.mgr).await;

    assert!(!holds_history(&f.mgr), "the raw history is gone");
    assert!(f.mgr.shared.messages.lock().unwrap().is_released("c1"));
    let kept = f.mgr.shared.active("c1").expect("the cell stays");
    assert!(Arc::ptr_eq(&cell, &kept));
    assert_eq!(f.session.kills(), 0, "nothing is stopped");
    assert_eq!(
        f.mgr.worktree_offers_for_chat("c1").len(),
        1,
        "worktree offers stay"
    );
    assert_eq!(
        f.surface.released(),
        vec!["c1"],
        "the facade drops its revision log"
    );
    assert!(
        !f.deps
            .events()
            .iter()
            .any(|e| matches!(e, DaemonEvent::ChatOffloaded { .. })),
        "a release is not an offload"
    );
}

#[tokio::test]
async fn the_release_follows_the_idle_setting() {
    let short = fixture_with(11 * MINUTE, |_| {});
    scan(&short.mgr).await;
    assert!(!holds_history(&short.mgr), "the default is ten minutes");

    let recent = fixture_with(9 * MINUTE, |_| {});
    scan(&recent.mgr).await;
    assert!(holds_history(&recent.mgr));

    let longer = fixture_with(45 * MINUTE, |_| {});
    longer
        .deps
        .settings
        .set("general", "historyRelease.idleMinutes", "60")
        .await
        .unwrap();
    scan(&longer.mgr).await;
    assert!(holds_history(&longer.mgr), "an hour's setting keeps it");

    let never = fixture_with(110 * MINUTE, |_| {});
    never
        .deps
        .settings
        .set("general", "historyRelease.idleMinutes", "never")
        .await
        .unwrap();
    scan(&never.mgr).await;
    assert!(holds_history(&never.mgr), "never keeps it");
}

#[tokio::test]
async fn the_idle_offload_drops_the_revision_log_too() {
    let f = fixture_with(IDLE_THRESHOLD_MS + 5 * MINUTE, |_| {});

    f.mgr.scan_idle_sessions().await;

    assert!(f.mgr.shared.active("c1").is_none(), "offloaded");
    assert_eq!(
        f.surface.released(),
        vec!["c1"],
        "the facade hub has no other signal to drop the chat's revision log"
    );
}

/// Gives "c1" an idle-compaction run that finished `ago_ms` ago, with the
/// feature on.
async fn finish_real_run(f: &Fixture, ago_ms: i64) {
    let db = mainframe_db::actor::SqliteActor::spawn(move || {
        let d = mainframe_db::DatabaseManager::open(std::path::Path::new(":memory:"))?;
        d.connection().execute(
            "INSERT INTO projects(id,name,path,created_at,last_opened_at) VALUES ('p1','p','/p','','')",
            [],
        )?;
        d.connection().execute(
            "INSERT INTO chats(id,project_id,adapter_id,status,created_at,updated_at) VALUES ('c1','p1','claude','active','','')",
            [],
        )?;
        Ok(d)
    })
    .unwrap();
    assert!(f.deps.store.idle_db.set(db).is_ok());
    f.deps
        .settings
        .set("general", "idleCompaction.enabled", "true")
        .await
        .unwrap();
    f.deps.idle_run_begin("c1", "run").unwrap();
    f.deps
        .idle_run_complete("c1", "run", Some(now_ms() - ago_ms))
        .unwrap();
}

#[path = "chat_manager_tests_release_complete.rs"]
mod complete;
#[path = "chat_manager_tests_release_integrity.rs"]
mod integrity;
#[path = "chat_manager_tests_release_restore.rs"]
mod restore;
#[path = "chat_manager_tests_release_return.rs"]
mod returning;
#[path = "chat_manager_tests_release_rules.rs"]
mod rules;
