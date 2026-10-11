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
    assert_eq!(err.status_kind(), StatusKind::BadRequest);
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
