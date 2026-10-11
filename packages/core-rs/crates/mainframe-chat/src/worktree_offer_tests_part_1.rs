use super::*;
use crate::test_support::{FakeDeps, test_chat};
use mainframe_types::http_status::StatusKind;

use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};

use mainframe_services::workspace::WorktreeEntry;
use mainframe_types::events::DaemonEvent;
use mainframe_types::worktree_offer::{WorktreeOfferOutcome, WorktreeSwitchOffer};

const CHAT: &str = "chat-1";
const OTHER_CHAT: &str = "chat-2";
const PROJECT_ID: &str = "p-1";
const PROJECT_PATH: &str = "/repo";
/// The two clock readings every `detected_at` assertion below is pinned to.
const T1: i64 = 1_700_000_000_000;
const T2: i64 = 1_700_000_009_999;

/// The registry over the shared fake deps: `CHAT` and `OTHER_CHAT` are stored
/// unbound in `PROJECT_ID`, whose path is `PROJECT_PATH`, until a test rebinds one.
struct Harness {
    deps: Arc<FakeDeps>,
    clock: Arc<AtomicI64>,
    registry: Arc<WorktreeOfferRegistry>,
}

impl Harness {
    fn new() -> Self {
        let chats = [CHAT, OTHER_CHAT].map(|id| {
            let mut chat = test_chat(id);
            chat.project_id = PROJECT_ID.to_string();
            chat
        });
        let deps = FakeDeps::with_chats(chats.to_vec());
        deps.set_project_path(PROJECT_PATH);
        let clock = Arc::new(AtomicI64::new(T1));
        let ticks = clock.clone();
        let now: NowFn = Arc::new(move || ticks.load(Ordering::SeqCst));
        let shared = ChatShared::new(deps.clone());
        let registry = Arc::new(WorktreeOfferRegistry::with_clock(shared, now));
        Self {
            deps,
            clock,
            registry,
        }
    }

    /// Binds `CHAT` to `worktree_path` in the store.
    fn set_binding(&self, worktree_path: Option<&str>) {
        let mut chats = self.deps.store.chats.lock().unwrap();
        if let Some(chat) = chats.get_mut(CHAT) {
            chat.worktree_path = worktree_path.map(str::to_string);
        }
    }

    /// Stores one other chat per path, each bound to it in `PROJECT_ID`.
    fn set_other_chat_worktrees(&self, paths: &[&str]) {
        for (i, path) in paths.iter().enumerate() {
            let mut chat = test_chat(&format!("occupant-{i}"));
            chat.project_id = PROJECT_ID.to_string();
            chat.worktree_path = Some((*path).to_string());
            self.deps.store.insert(chat);
        }
    }

    fn set_clock(&self, epoch_ms: i64) {
        self.clock.store(epoch_ms, Ordering::SeqCst);
    }

    /// The listing always carries the main checkout; `extra` is what an agent added.
    fn set_worktrees(&self, extra: Vec<WorktreeEntry>) {
        let mut entries = vec![entry(PROJECT_PATH, Some("refs/heads/main"))];
        entries.extend(extra);
        self.deps.set_listing(entries);
    }

    /// Baseline = the main checkout alone, so every later entry counts as new.
    async fn seed_empty_baseline(&self) {
        self.set_worktrees(Vec::new());
        self.registry.seed_baseline(CHAT, PROJECT_PATH).await;
        self.deps.clear_events();
    }

    /// Awaited directly rather than racing `on_trigger`'s spawned task.
    async fn rescan(&self) {
        self.registry.clone().rescan(CHAT.to_string()).await;
    }

    fn snapshot(&self) -> Vec<WorktreeSwitchOffer> {
        self.registry.snapshot(CHAT)
    }
}

fn entry(path: &str, branch: Option<&str>) -> WorktreeEntry {
    WorktreeEntry {
        path: path.to_string(),
        branch: branch.map(str::to_string),
    }
}

fn offer(worktree_path: &str, branch_name: Option<&str>, detected_at: i64) -> WorktreeSwitchOffer {
    WorktreeSwitchOffer {
        chat_id: CHAT.to_string(),
        worktree_path: worktree_path.to_string(),
        branch_name: branch_name.map(str::to_string),
        detected_at,
    }
}

fn raised(offer: WorktreeSwitchOffer) -> DaemonEvent {
    DaemonEvent::WorktreeOfferRaised {
        chat_id: CHAT.to_string(),
        offer,
    }
}

fn resolved(worktree_path: &str, outcome: WorktreeOfferOutcome) -> DaemonEvent {
    DaemonEvent::WorktreeOfferResolved {
        chat_id: CHAT.to_string(),
        worktree_path: worktree_path.to_string(),
        outcome,
    }
}

fn no_events() -> Vec<DaemonEvent> {
    Vec::new()
}

fn no_offers() -> Vec<WorktreeSwitchOffer> {
    Vec::new()
}

fn no_writes() -> Vec<(String, String)> {
    Vec::new()
}

/// Writes the `.git` link file `git worktree add` leaves behind, stamped at a
/// chosen mtime — that stamp is the worktree's identity, so an explicit one
/// keeps "rebuilt in place" independent of filesystem timestamp resolution.
fn write_git_link(worktree: &std::path::Path, mtime_secs: u64) {
    let link = worktree.join(".git");
    std::fs::write(
        &link,
        format!("gitdir: /repo/.git/worktrees/{mtime_secs}\n"),
    )
    .unwrap();
    let stamp = std::time::UNIX_EPOCH + std::time::Duration::from_secs(mtime_secs);
    std::fs::File::options()
        .write(true)
        .open(&link)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(stamp))
        .unwrap();
}

/// A real directory whose raw and canonical spellings differ on macOS
/// (`/var/folders/…` → `/private/var/folders/…`). The equality assertion keeps
/// the case meaningful on platforms where the two spellings coincide.
fn temp_worktree() -> (tempfile::TempDir, String, String) {
    let dir = tempfile::tempdir().unwrap();
    let raw = dir.path().to_string_lossy().into_owned();
    let canonical = std::fs::canonicalize(dir.path())
        .unwrap()
        .to_string_lossy()
        .into_owned();
    assert_eq!(
        std::fs::canonicalize(&raw).unwrap(),
        std::fs::canonicalize(&canonical).unwrap(),
        "both spellings must resolve to one canonical path"
    );
    (dir, raw, canonical)
}

#[tokio::test]
async fn seed_baseline_captures_the_registered_set_so_an_unchanged_rescan_is_silent() {
    let h = Harness::new();
    h.set_worktrees(vec![entry("/repo/.worktrees/a", Some("refs/heads/feat/a"))]);
    h.registry.seed_baseline(CHAT, PROJECT_PATH).await;

    h.rescan().await;

    assert_eq!(h.deps.events(), no_events());
    assert_eq!(h.snapshot(), no_offers());
}

#[tokio::test]
async fn a_rescan_with_no_baseline_seeds_it_defensively_and_raises_nothing() {
    let h = Harness::new();
    h.set_worktrees(vec![entry("/repo/.worktrees/a", Some("refs/heads/feat/a"))]);

    h.rescan().await;
    assert_eq!(h.deps.events(), no_events());

    h.rescan().await;
    assert_eq!(h.deps.events(), no_events());

    // The seeded baseline is real, not a skipped scan: a genuinely new path still raises.
    h.set_clock(T2);
    h.set_worktrees(vec![
        entry("/repo/.worktrees/a", Some("refs/heads/feat/a")),
        entry("/repo/.worktrees/b", Some("refs/heads/feat/b")),
    ]);
    h.rescan().await;

    assert_eq!(
        h.deps.events(),
        vec![raised(offer("/repo/.worktrees/b", Some("feat/b"), T2))]
    );
}

#[tokio::test]
async fn raises_one_offer_carrying_the_worktree_path_and_the_short_branch_name() {
    let h = Harness::new();
    h.seed_empty_baseline().await;
    h.set_worktrees(vec![entry("/repo/.worktrees/x", Some("refs/heads/feat/x"))]);

    h.rescan().await;

    assert_eq!(
        h.deps.events(),
        vec![raised(offer("/repo/.worktrees/x", Some("feat/x"), T1))]
    );
    assert_eq!(
        h.snapshot(),
        vec![offer("/repo/.worktrees/x", Some("feat/x"), T1)]
    );
}

#[tokio::test]
async fn does_not_raise_a_second_time_for_a_path_that_is_already_pending() {
    let h = Harness::new();
    h.seed_empty_baseline().await;
    h.set_worktrees(vec![entry("/repo/.worktrees/x", Some("refs/heads/feat/x"))]);
    h.rescan().await;
    h.deps.clear_events();

    h.set_clock(T2);
    h.rescan().await;

    assert_eq!(h.deps.events(), no_events());
    // Still the first detection's timestamp — the pending offer was never re-stamped.
    assert_eq!(
        h.snapshot(),
        vec![offer("/repo/.worktrees/x", Some("feat/x"), T1)]
    );
}

#[tokio::test]
async fn reseeding_the_baseline_drops_pending_and_reoffers_a_recreated_worktree() {
    let h = Harness::new();
    h.seed_empty_baseline().await;
    h.set_worktrees(vec![entry("/repo/.worktrees/a", Some("refs/heads/feat/a"))]);
    h.rescan().await;
    assert_eq!(
        h.snapshot(),
        vec![offer("/repo/.worktrees/a", Some("feat/a"), T1)]
    );
    h.deps.clear_events();

    // Re-activation after the worktree was deleted. Dropping pending is silent:
    // subscribers re-seed from the subscribe snapshot, so a resolved burst is noise.
    h.set_worktrees(Vec::new());
    h.registry.seed_baseline(CHAT, PROJECT_PATH).await;
    assert_eq!(h.snapshot(), no_offers());
    assert_eq!(h.deps.events(), no_events());

    h.set_clock(T2);
    h.set_worktrees(vec![entry("/repo/.worktrees/a", Some("refs/heads/feat/a"))]);
    h.rescan().await;

    assert_eq!(
        h.deps.events(),
        vec![raised(offer("/repo/.worktrees/a", Some("feat/a"), T2))]
    );
}
