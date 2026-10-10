use super::*;

#[tokio::test]
async fn never_kills_a_launch_group_whose_cwd_no_longer_matches() {
    let registry = FakeRegistry::new(vec![launch(5000)]);
    let (kill, calls) = recording_kill(true);
    sweep_stray_children(
        &*registry,
        &deps(
            constant_command("/opt/homebrew/bin/pnpm run dev"),
            constant_cwd(Some("/Users/me/other")),
            kill,
        ),
    )
    .await;
    assert!(calls.lock().unwrap().is_empty());
    assert_eq!(registry.remaining(), Vec::<i64>::new());
}

#[tokio::test]
async fn prunes_the_stale_record_of_a_pid_no_longer_alive() {
    let registry = FakeRegistry::new(vec![launch(5000)]);
    let (kill, calls) = recording_kill(true);
    let result =
        sweep_stray_children(&*registry, &deps(none_command(), constant_cwd(None), kill)).await;
    assert!(calls.lock().unwrap().is_empty());
    assert_eq!(
        result,
        SweepResult {
            total: 1,
            reaped: 0,
            skipped: 1
        }
    );
    assert_eq!(registry.remaining(), Vec::<i64>::new());
}

#[tokio::test]
async fn reaps_matching_entries_out_of_a_mixed_set() {
    let registry = FakeRegistry::new(vec![tunnel(1), launch(2), launch(3)]);
    let (kill, calls) = recording_kill(true);
    let result = sweep_stray_children(
        &*registry,
        &deps(
            dies_on_sigterm(HashMap::from([
                (1, Some(format!("{BIN} tunnel --url http://localhost:4173"))),
                (2, Some(format!("{PNPM} run dev"))),
                (3, Some("/opt/other/thing".to_string())),
            ])),
            constant_cwd(Some(CWD)),
            kill,
        ),
    )
    .await;
    let calls = calls.lock().unwrap();
    assert_eq!(calls.len(), 2);
    assert!(calls.contains(&(1, "SIGTERM".to_string(), false)));
    assert!(calls.contains(&(2, "SIGTERM".to_string(), true)));
    assert_eq!(
        result,
        SweepResult {
            total: 3,
            reaped: 2,
            skipped: 1
        }
    );
    assert_eq!(registry.remaining(), Vec::<i64>::new());
}

#[tokio::test]
async fn leaves_the_registry_intact_and_reaps_nothing_on_win32() {
    let registry = FakeRegistry::new(vec![tunnel(1), launch(2)]);
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    let process_command: ProcessQueryFn = Arc::new(move |_pid| {
        seen.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Some(format!("{BIN} tunnel run")) })
    });
    let (kill, kill_calls) = recording_kill(true);
    let result = sweep_stray_children(
        &*registry,
        &SweepDeps {
            process_command,
            process_cwd: constant_cwd(None),
            kill,
            platform: Some(SweepPlatform::Win32),
            grace: None,
        },
    )
    .await;
    assert!(kill_calls.lock().unwrap().is_empty());
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert_eq!(registry.remaining(), vec![1, 2]);
    assert_eq!(
        result,
        SweepResult {
            total: 2,
            reaped: 0,
            skipped: 2
        }
    );
}

#[tokio::test]
async fn retains_the_record_of_a_still_alive_orphan_whose_kill_fails() {
    let registry = FakeRegistry::new(vec![launch(5000)]);
    let (kill, calls) = recording_kill(false);
    let result = sweep_stray_children(
        &*registry,
        &deps(
            constant_command("/opt/homebrew/bin/pnpm run dev"),
            constant_cwd(Some(CWD)),
            kill,
        ),
    )
    .await;
    assert_eq!(
        *calls.lock().unwrap(),
        vec![(5000, "SIGTERM".to_string(), true)]
    );
    assert_eq!(
        result,
        SweepResult {
            total: 1,
            reaped: 0,
            skipped: 1
        }
    );
    assert_eq!(registry.remaining(), vec![5000]);
}

#[tokio::test]
async fn treats_a_failing_kill_as_a_failure_and_retains_the_record() {
    let registry = FakeRegistry::new(vec![launch(1), launch(2)]);
    let kill: KillFn = Arc::new(|pid, _sig, _group| pid != 1);
    let result = sweep_stray_children(
        &*registry,
        &deps(
            dies_on_sigterm(HashMap::from([
                (1, Some(format!("{PNPM} run dev"))),
                (2, Some(format!("{PNPM} run dev"))),
            ])),
            constant_cwd(Some(CWD)),
            kill,
        ),
    )
    .await;
    assert_eq!(
        result,
        SweepResult {
            total: 2,
            reaped: 1,
            skipped: 1
        }
    );
    assert_eq!(registry.remaining(), vec![1]);
}

#[tokio::test]
async fn does_not_query_cwd_for_tunnels() {
    let registry = FakeRegistry::new(vec![tunnel(1)]);
    let queried = Arc::new(AtomicUsize::new(0));
    let counter = queried.clone();
    let process_cwd: ProcessQueryFn = Arc::new(move |_pid| {
        counter.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { None })
    });
    let (kill, _calls) = recording_kill(true);
    sweep_stray_children(
        &*registry,
        &deps(
            dies_on_sigterm(HashMap::from([(1, Some(format!("{BIN} tunnel run")))])),
            process_cwd,
            kill,
        ),
    )
    .await;
    assert_eq!(queried.load(Ordering::SeqCst), 0);
}

#[test]
fn invalid_targets_and_unknown_signals_are_rejected() {
    assert!(!default_kill(0, "SIGTERM", false));
    assert!(!default_kill(-1, "SIGKILL", true));
    assert!(!default_kill(1, "UNKNOWN", false));
}

#[test]
fn noop_registry_is_a_child_registry_port() {
    // Compile-time proof the trait object type-checks for the sweep signature.
    fn _accepts(_r: &dyn ChildRegistryPort) {}
    _accepts(&NoopChildRegistry);
}
