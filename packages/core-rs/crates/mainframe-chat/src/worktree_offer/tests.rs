use super::*;

use std::collections::HashSet;
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};

use mainframe_adapter_api::BoxFuture;
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

/// Records everything the registry does to the outside world: emitted events,
/// dismissed-set writes, and how often it listed worktrees.
struct FakeDeps {
    listing: StdMutex<Vec<WorktreeEntry>>,
    list_calls: AtomicUsize,
    events: StdMutex<Vec<DaemonEvent>>,
    binding: StdMutex<Option<(String, Option<String>)>>,
    others: StdMutex<HashSet<String>>,
    dismissed: StdMutex<Vec<String>>,
    dismiss_writes: StdMutex<Vec<(String, String)>>,
}

impl Default for FakeDeps {
    fn default() -> Self {
        Self {
            listing: StdMutex::new(Vec::new()),
            list_calls: AtomicUsize::new(0),
            events: StdMutex::new(Vec::new()),
            binding: StdMutex::new(Some((PROJECT_ID.to_string(), None))),
            others: StdMutex::new(HashSet::new()),
            dismissed: StdMutex::new(Vec::new()),
            dismiss_writes: StdMutex::new(Vec::new()),
        }
    }
}

impl FakeDeps {
    fn events(&self) -> Vec<DaemonEvent> {
        self.events.lock().unwrap().clone()
    }
    fn clear_events(&self) {
        self.events.lock().unwrap().clear();
    }
    fn list_calls(&self) -> usize {
        self.list_calls.load(Ordering::SeqCst)
    }
    fn dismiss_writes(&self) -> Vec<(String, String)> {
        self.dismiss_writes.lock().unwrap().clone()
    }
    fn set_listing(&self, entries: Vec<WorktreeEntry>) {
        *self.listing.lock().unwrap() = entries;
    }
    fn set_binding(&self, worktree_path: Option<&str>) {
        let binding = (PROJECT_ID.to_string(), worktree_path.map(str::to_string));
        *self.binding.lock().unwrap() = Some(binding);
    }
    fn set_other_chat_worktrees(&self, paths: &[&str]) {
        *self.others.lock().unwrap() = paths.iter().map(|p| p.to_string()).collect();
    }
}

impl WorktreeOfferDeps for FakeDeps {
    fn emit_event(&self, event: DaemonEvent) {
        self.events.lock().unwrap().push(event);
    }
    fn projects_get_path(&self, _project_id: &str) -> Option<String> {
        Some(PROJECT_PATH.to_string())
    }
    fn chat_binding(&self, _chat_id: &str) -> Option<(String, Option<String>)> {
        self.binding.lock().unwrap().clone()
    }
    fn other_chat_worktrees(&self, _project_id: &str, _chat_id: &str) -> HashSet<String> {
        self.others.lock().unwrap().clone()
    }
    fn get_dismissed_worktrees(&self, _chat_id: &str) -> Vec<String> {
        self.dismissed.lock().unwrap().clone()
    }
    fn add_dismissed_worktree(&self, chat_id: &str, worktree_path: &str) -> bool {
        self.dismiss_writes
            .lock()
            .unwrap()
            .push((chat_id.to_string(), worktree_path.to_string()));
        let mut dismissed = self.dismissed.lock().unwrap();
        if dismissed.iter().any(|p| p == worktree_path) {
            return false;
        }
        dismissed.push(worktree_path.to_string());
        true
    }
    fn list_worktrees<'a>(&'a self, _project_path: &'a str) -> BoxFuture<'a, Vec<WorktreeEntry>> {
        self.list_calls.fetch_add(1, Ordering::SeqCst);
        let entries = self.listing.lock().unwrap().clone();
        Box::pin(async move { entries })
    }
}

struct Harness {
    deps: Arc<FakeDeps>,
    clock: Arc<AtomicI64>,
    registry: Arc<WorktreeOfferRegistry>,
}

impl Harness {
    fn new() -> Self {
        let deps = Arc::new(FakeDeps::default());
        let clock = Arc::new(AtomicI64::new(T1));
        let ticks = clock.clone();
        let now: NowFn = Arc::new(move || ticks.load(Ordering::SeqCst));
        let registry = Arc::new(WorktreeOfferRegistry::with_clock(deps.clone(), now));
        Self {
            deps,
            clock,
            registry,
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

#[tokio::test]
async fn reoffers_a_worktree_deleted_and_recreated_at_the_same_path_since_activation() {
    let h = Harness::new();
    // Present at activation, so it starts out as old news.
    h.set_worktrees(vec![entry("/repo/.worktrees/a", Some("refs/heads/feat/a"))]);
    h.registry.seed_baseline(CHAT, PROJECT_PATH).await;
    h.deps.clear_events();

    // `git worktree remove` is itself a trigger, and that scan drops the path.
    // (The same thing done in a single command is covered by the identity check
    // in `reoffers_a_worktree_rebuilt_in_place_without_ever_being_seen_absent`.)
    h.set_worktrees(Vec::new());
    h.rescan().await;
    assert_eq!(h.deps.events(), no_events());

    h.set_clock(T2);
    h.set_worktrees(vec![entry("/repo/.worktrees/a", Some("refs/heads/feat/a"))]);
    h.rescan().await;

    assert_eq!(
        h.deps.events(),
        vec![raised(offer("/repo/.worktrees/a", Some("feat/a"), T2))]
    );
}

/// `git worktree remove X && git worktree add X` is one tool call, so one scan:
/// the path is never observed absent and the listing looks unchanged. Only the
/// worktree's own identity distinguishes the rebuild.
#[tokio::test]
async fn reoffers_a_worktree_rebuilt_in_place_without_ever_being_seen_absent() {
    let dir = tempfile::tempdir().unwrap();
    let path = std::fs::canonicalize(dir.path())
        .unwrap()
        .to_string_lossy()
        .into_owned();
    write_git_link(dir.path(), 1_000);

    let h = Harness::new();
    h.set_worktrees(vec![entry(&path, Some("refs/heads/feat/a"))]);
    h.registry.seed_baseline(CHAT, PROJECT_PATH).await;
    h.deps.clear_events();

    // Untouched: same worktree, no offer.
    h.rescan().await;
    assert_eq!(h.deps.events(), no_events());

    // Rebuilt in place — same path, same branch, new worktree.
    write_git_link(dir.path(), 2_000);
    h.set_clock(T2);
    h.rescan().await;

    assert_eq!(
        h.deps.events(),
        vec![raised(offer(&path, Some("feat/a"), T2))]
    );
}

#[tokio::test]
async fn a_failed_git_listing_keeps_the_baseline_instead_of_flooding_the_next_scan() {
    let h = Harness::new();
    h.set_worktrees(vec![entry("/repo/.worktrees/a", Some("refs/heads/feat/a"))]);
    h.registry.seed_baseline(CHAT, PROJECT_PATH).await;
    h.deps.clear_events();

    // git failed: an empty listing must not be read as "every worktree is gone".
    h.deps.set_listing(Vec::new());
    h.rescan().await;
    assert_eq!(h.deps.events(), no_events());

    h.set_clock(T2);
    h.set_worktrees(vec![entry("/repo/.worktrees/a", Some("refs/heads/feat/a"))]);
    h.rescan().await;

    assert_eq!(
        h.deps.events(),
        no_events(),
        "the pre-existing worktree is still old news; re-baselining to nothing would have offered it"
    );
}

#[tokio::test]
async fn expires_a_pending_offer_whose_worktree_vanished_from_the_listing() {
    let h = Harness::new();
    h.seed_empty_baseline().await;
    h.set_worktrees(vec![entry(
        "/repo/.worktrees/gone",
        Some("refs/heads/feat/gone"),
    )]);
    h.rescan().await;
    h.deps.clear_events();

    h.set_worktrees(Vec::new());
    h.rescan().await;

    assert_eq!(
        h.deps.events(),
        vec![resolved(
            "/repo/.worktrees/gone",
            WorktreeOfferOutcome::Expired
        )]
    );
    assert_eq!(h.snapshot(), no_offers());
}

#[tokio::test]
async fn dismiss_persists_the_path_resolves_it_and_silences_later_rescans() {
    let h = Harness::new();
    h.seed_empty_baseline().await;
    h.set_worktrees(vec![entry(
        "/repo/.worktrees/nope",
        Some("refs/heads/feat/nope"),
    )]);
    h.rescan().await;
    h.deps.clear_events();

    h.registry.dismiss(CHAT, "/repo/.worktrees/nope").unwrap();

    assert_eq!(
        h.deps.dismiss_writes(),
        vec![(CHAT.to_string(), "/repo/.worktrees/nope".to_string())]
    );
    assert_eq!(
        h.deps.events(),
        vec![resolved(
            "/repo/.worktrees/nope",
            WorktreeOfferOutcome::Dismissed
        )]
    );
    assert_eq!(h.snapshot(), no_offers());

    // The path is still registered in git; the dismissal is what keeps it quiet.
    h.deps.clear_events();
    h.set_clock(T2);
    h.rescan().await;

    assert_eq!(h.deps.events(), no_events());
    assert_eq!(h.snapshot(), no_offers());
}

#[tokio::test]
async fn dismiss_rejects_a_path_that_is_not_pending_and_writes_nothing() {
    let h = Harness::new();
    h.seed_empty_baseline().await;
    h.set_worktrees(vec![entry("/repo/.worktrees/a", Some("refs/heads/feat/a"))]);
    h.rescan().await;
    h.deps.clear_events();

    let err = h
        .registry
        .dismiss(CHAT, "/repo/.worktrees/ghost")
        .unwrap_err();

    assert!(matches!(err, OfferError::NotPending), "got {err:?}");
    assert_eq!(err.status_code(), 400);
    assert_eq!(h.deps.dismiss_writes(), no_writes());
    assert_eq!(h.deps.events(), no_events());
    assert_eq!(
        h.snapshot(),
        vec![offer("/repo/.worktrees/a", Some("feat/a"), T1)]
    );
}

#[tokio::test]
async fn binding_changed_resolves_a_pending_path_as_accepted_but_stays_silent_otherwise() {
    let h = Harness::new();
    h.seed_empty_baseline().await;
    h.set_worktrees(vec![entry("/repo/.worktrees/a", Some("refs/heads/feat/a"))]);
    h.rescan().await;
    h.deps.clear_events();

    h.registry
        .on_binding_changed(CHAT, Some("/repo/.worktrees/a"));

    assert_eq!(
        h.deps.events(),
        vec![resolved(
            "/repo/.worktrees/a",
            WorktreeOfferOutcome::Accepted
        )]
    );
    assert_eq!(h.snapshot(), no_offers());

    // A manual popover attach to a worktree that was never offered stays silent.
    h.deps.clear_events();
    h.registry
        .on_binding_changed(CHAT, Some("/repo/.worktrees/never-offered"));

    assert_eq!(h.deps.events(), no_events());
}

#[tokio::test]
async fn a_burst_of_triggers_during_an_in_flight_rescan_collapses_to_one_trailing_rescan() {
    let h = Harness::new();
    h.set_worktrees(Vec::new());

    for _ in 0..5 {
        h.registry.on_trigger(CHAT);
    }
    // The fake's listing future is ready immediately, so a bounded yield loop
    // drains every spawned rescan without touching the wall clock.
    for _ in 0..64 {
        tokio::task::yield_now().await;
    }

    let calls = h.deps.list_calls();
    assert!(
        calls >= 1,
        "expected the burst to run a rescan, got {calls}"
    );
    assert!(
        calls <= 2,
        "expected at most one trailing rescan, got {calls}"
    );
    assert_eq!(h.deps.events(), no_events());
}

#[tokio::test]
async fn snapshot_returns_pending_offers_ordered_by_detected_at_ascending() {
    let h = Harness::new();
    h.seed_empty_baseline().await;

    // `zeta` is detected first but sorts last by path, so a path-ordered snapshot fails here.
    h.set_worktrees(vec![entry(
        "/repo/.worktrees/zeta",
        Some("refs/heads/feat/zeta"),
    )]);
    h.rescan().await;

    h.set_clock(T2);
    h.set_worktrees(vec![
        entry("/repo/.worktrees/zeta", Some("refs/heads/feat/zeta")),
        entry("/repo/.worktrees/alpha", Some("refs/heads/feat/alpha")),
    ]);
    h.rescan().await;

    assert_eq!(
        h.snapshot(),
        vec![
            offer("/repo/.worktrees/zeta", Some("feat/zeta"), T1),
            offer("/repo/.worktrees/alpha", Some("feat/alpha"), T2),
        ]
    );
}

#[tokio::test]
async fn snapshot_is_scoped_to_the_chat() {
    let h = Harness::new();
    h.seed_empty_baseline().await;
    h.set_worktrees(vec![entry(
        "/repo/.worktrees/mine",
        Some("refs/heads/feat/mine"),
    )]);
    h.rescan().await;

    // chat-2 baselines on chat-1's worktree, so only `theirs` is ever new to it.
    h.registry.seed_baseline(OTHER_CHAT, PROJECT_PATH).await;
    h.set_clock(T2);
    h.set_worktrees(vec![
        entry("/repo/.worktrees/mine", Some("refs/heads/feat/mine")),
        entry("/repo/.worktrees/theirs", Some("refs/heads/feat/theirs")),
    ]);
    h.registry.clone().rescan(OTHER_CHAT.to_string()).await;

    assert_eq!(
        h.snapshot(),
        vec![offer("/repo/.worktrees/mine", Some("feat/mine"), T1)]
    );
    assert_eq!(
        h.registry.snapshot(OTHER_CHAT),
        vec![WorktreeSwitchOffer {
            chat_id: OTHER_CHAT.to_string(),
            worktree_path: "/repo/.worktrees/theirs".to_string(),
            branch_name: Some("feat/theirs".to_string()),
            detected_at: T2,
        }]
    );
}

#[tokio::test]
async fn claim_accept_guards_one_switch_at_a_time_and_leaves_the_offer_pending() {
    let h = Harness::new();
    h.seed_empty_baseline().await;
    h.set_worktrees(vec![entry("/repo/.worktrees/a", Some("refs/heads/feat/a"))]);
    h.rescan().await;
    h.set_clock(T2);
    h.set_worktrees(vec![
        entry("/repo/.worktrees/a", Some("refs/heads/feat/a")),
        entry("/repo/.worktrees/b", Some("refs/heads/feat/b")),
    ]);
    h.rescan().await;
    h.deps.clear_events();

    let unknown = h
        .registry
        .claim_accept(CHAT, "/repo/.worktrees/ghost")
        .unwrap_err();
    assert!(matches!(unknown, OfferError::NotPending), "got {unknown:?}");
    assert_eq!(unknown.status_code(), 400);

    let claimed = h.registry.claim_accept(CHAT, "/repo/.worktrees/a").unwrap();
    assert_eq!(claimed, offer("/repo/.worktrees/a", Some("feat/a"), T1));
    // A failed rebind must not lose the offer, so claiming leaves it pending.
    assert_eq!(
        h.snapshot(),
        vec![
            offer("/repo/.worktrees/a", Some("feat/a"), T1),
            offer("/repo/.worktrees/b", Some("feat/b"), T2),
        ]
    );

    let busy = h
        .registry
        .claim_accept(CHAT, "/repo/.worktrees/b")
        .unwrap_err();
    assert!(matches!(busy, OfferError::SwitchInProgress), "got {busy:?}");
    assert_eq!(busy.status_code(), 409);

    h.registry.release_accept(CHAT);
    let reclaimed = h.registry.claim_accept(CHAT, "/repo/.worktrees/b").unwrap();
    assert_eq!(reclaimed, offer("/repo/.worktrees/b", Some("feat/b"), T2));
    assert_eq!(h.deps.events(), no_events());
}

#[tokio::test]
async fn never_offers_a_worktree_already_occupied_under_another_path_spelling() {
    let (_dir, raw, canonical) = temp_worktree();

    let own = Harness::new();
    own.deps.set_binding(Some(raw.as_str()));
    own.seed_empty_baseline().await;
    own.set_worktrees(vec![entry(&canonical, Some("refs/heads/feat/tmp"))]);
    own.rescan().await;

    assert_eq!(own.deps.events(), no_events());
    assert_eq!(own.snapshot(), no_offers());

    let other = Harness::new();
    other.deps.set_other_chat_worktrees(&[raw.as_str()]);
    other.seed_empty_baseline().await;
    other.set_worktrees(vec![entry(&canonical, Some("refs/heads/feat/tmp"))]);
    other.rescan().await;

    assert_eq!(other.deps.events(), no_events());
    assert_eq!(other.snapshot(), no_offers());
}

#[tokio::test]
async fn dismiss_rejects_the_path_of_an_in_flight_switch_and_writes_nothing() {
    let h = Harness::new();
    h.seed_empty_baseline().await;
    h.set_worktrees(vec![entry("/repo/.worktrees/a", Some("refs/heads/feat/a"))]);
    h.rescan().await;
    h.registry.claim_accept(CHAT, "/repo/.worktrees/a").unwrap();
    h.deps.clear_events();

    let err = h.registry.dismiss(CHAT, "/repo/.worktrees/a").unwrap_err();

    assert!(matches!(err, OfferError::SwitchInProgress), "got {err:?}");
    assert_eq!(err.status_code(), 409);
    assert_eq!(h.deps.dismiss_writes(), no_writes());
    assert_eq!(h.deps.events(), no_events());
    assert_eq!(
        h.snapshot(),
        vec![offer("/repo/.worktrees/a", Some("feat/a"), T1)]
    );
}

#[tokio::test]
async fn forget_drops_the_chats_baseline_and_pending_so_the_next_rescan_reseeds() {
    let h = Harness::new();
    h.seed_empty_baseline().await;
    h.set_worktrees(vec![entry("/repo/.worktrees/a", Some("refs/heads/feat/a"))]);
    h.rescan().await;
    h.deps.clear_events();

    h.registry.forget(CHAT);
    assert_eq!(h.snapshot(), no_offers());

    h.set_clock(T2);
    h.rescan().await;
    assert_eq!(h.deps.events(), no_events());
    assert_eq!(h.snapshot(), no_offers());

    // The re-seed captured `a`, so only a path newer than it raises.
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
