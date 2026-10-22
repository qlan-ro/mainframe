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
    assert_eq!(unknown.status_kind(), StatusKind::BadRequest);

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
    assert_eq!(busy.status_kind(), StatusKind::Conflict);

    h.registry.release_accept(CHAT);
    let reclaimed = h.registry.claim_accept(CHAT, "/repo/.worktrees/b").unwrap();
    assert_eq!(reclaimed, offer("/repo/.worktrees/b", Some("feat/b"), T2));
    assert_eq!(h.deps.events(), no_events());
}

#[tokio::test]
async fn never_offers_a_worktree_already_occupied_under_another_path_spelling() {
    let (_dir, raw, canonical) = temp_worktree();

    let own = Harness::new();
    own.set_binding(Some(raw.as_str()));
    own.seed_empty_baseline().await;
    own.set_worktrees(vec![entry(&canonical, Some("refs/heads/feat/tmp"))]);
    own.rescan().await;

    assert_eq!(own.deps.events(), no_events());
    assert_eq!(own.snapshot(), no_offers());

    let other = Harness::new();
    other.set_other_chat_worktrees(&[raw.as_str()]);
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
    assert_eq!(err.status_kind(), StatusKind::Conflict);
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

#[tokio::test]
async fn a_chat_forgotten_during_seed_is_not_recreated_by_the_late_listing() {
    let h = Harness::new();
    let gate = Arc::new((tokio::sync::Notify::new(), tokio::sync::Notify::new()));
    *h.deps.workspace.listing_gate.lock().unwrap() = Some(gate.clone());
    let seed = tokio::spawn({
        let registry = h.registry.clone();
        async move { registry.seed_baseline(CHAT, PROJECT_PATH).await }
    });
    gate.0.notified().await;
    h.registry.forget(CHAT);
    gate.1.notify_one();
    seed.await.unwrap();
    assert!(!h.registry.lock().contains_key(CHAT));
}
