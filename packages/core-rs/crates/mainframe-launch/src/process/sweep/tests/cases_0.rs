use super::*;

#[test]
fn binary_matches_the_exact_recorded_path() {
    assert!(process_matches_binary(
        &format!("{BIN} tunnel --url http://localhost:4173"),
        BIN
    ));
}

#[test]
fn binary_rejects_a_non_absolute_recorded_path() {
    assert!(!process_matches_binary(
        "cloudflared tunnel run",
        "cloudflared"
    ));
}

#[test]
fn binary_rejects_a_sibling_sharing_the_path_as_a_prefix() {
    assert!(!process_matches_binary(&format!("{BIN}-updater run"), BIN));
}

#[test]
fn launch_matches_when_full_argv_and_cwd_match() {
    assert!(process_matches_launch(
        Some(&format!("{PNPM} run dev")),
        Some(CWD),
        &launch(1)
    ));
}

#[test]
fn launch_matches_argv_only_invocation_with_matching_cwd() {
    assert!(process_matches_launch(
        Some(PNPM),
        Some(CWD),
        &launch_args(1, vec![], CWD.to_string())
    ));
}

#[test]
fn launch_rejects_when_the_command_line_differs() {
    assert!(!process_matches_launch(
        Some("/usr/bin/postgres -D /data"),
        Some(CWD),
        &launch(1)
    ));
}

#[test]
fn launch_rejects_when_only_a_fragment_of_the_argv_matches() {
    assert!(!process_matches_launch(
        Some(&format!("{PNPM} run dev --host")),
        Some(CWD),
        &launch(1)
    ));
}

#[test]
fn launch_rejects_when_the_cwd_differs() {
    assert!(!process_matches_launch(
        Some(&format!("{PNPM} run dev")),
        Some("/Users/me/other"),
        &launch(1)
    ));
}

#[test]
fn launch_rejects_when_the_live_cwd_is_unreadable() {
    assert!(!process_matches_launch(
        Some(&format!("{PNPM} run dev")),
        None,
        &launch(1)
    ));
}

#[tokio::test]
async fn reaps_a_tunnel_by_pid_when_its_command_matches() {
    let registry = FakeRegistry::new(vec![tunnel(4242)]);
    let (kill, calls) = recording_kill(true);
    let result = sweep_stray_children(
        &*registry,
        &deps(
            dies_on_sigterm(HashMap::from([(
                4242,
                Some(format!("{BIN} tunnel --url http://localhost:4173")),
            )])),
            constant_cwd(None),
            kill,
        ),
    )
    .await;
    assert_eq!(
        *calls.lock().unwrap(),
        vec![(4242, "SIGTERM".to_string(), false)]
    );
    assert_eq!(
        result,
        SweepResult {
            total: 1,
            reaped: 1,
            skipped: 0
        }
    );
    assert_eq!(registry.remaining(), Vec::<i64>::new());
}

#[tokio::test]
async fn reaps_a_launch_child_by_group_when_argv_and_cwd_match() {
    let registry = FakeRegistry::new(vec![launch(5000)]);
    let (kill, calls) = recording_kill(true);
    let result = sweep_stray_children(
        &*registry,
        &deps(
            dies_on_sigterm(HashMap::from([(5000, Some(format!("{PNPM} run dev")))])),
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
            reaped: 1,
            skipped: 0
        }
    );
    assert_eq!(registry.remaining(), Vec::<i64>::new());
}

#[tokio::test]
async fn escalates_to_sigkill_when_a_launch_orphan_survives_sigterm() {
    let registry = FakeRegistry::new(vec![launch(5000)]);
    let (kill, calls) = recording_kill(true);
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
        vec![
            (5000, "SIGTERM".to_string(), true),
            (5000, "SIGKILL".to_string(), true),
        ]
    );
    assert_eq!(
        result,
        SweepResult {
            total: 1,
            reaped: 1,
            skipped: 0
        }
    );
    assert_eq!(registry.remaining(), Vec::<i64>::new());
}

#[tokio::test]
async fn does_not_escalate_when_the_orphan_exits_on_sigterm() {
    let registry = FakeRegistry::new(vec![launch(5000)]);
    let (kill, calls) = recording_kill(true);
    sweep_stray_children(
        &*registry,
        &deps(
            dies_on_sigterm(HashMap::from([(5000, Some(format!("{PNPM} run dev")))])),
            constant_cwd(Some(CWD)),
            kill,
        ),
    )
    .await;
    assert_eq!(
        *calls.lock().unwrap(),
        vec![(5000, "SIGTERM".to_string(), true)]
    );
}

#[tokio::test]
async fn never_sigkills_a_pid_reused_during_the_grace_window() {
    let registry = FakeRegistry::new(vec![launch(5000)]);
    let (kill, calls) = recording_kill(true);
    let call = Arc::new(AtomicUsize::new(0));
    let process_command: ProcessQueryFn = Arc::new(move |_pid| {
        let call = call.clone();
        Box::pin(async move {
            let n = call.fetch_add(1, Ordering::SeqCst);
            Some(if n == 0 {
                format!("{PNPM} run dev")
            } else {
                "/usr/bin/postgres -D /data".to_string()
            })
        })
    });
    let result = sweep_stray_children(
        &*registry,
        &deps(process_command, constant_cwd(Some(CWD)), kill),
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
            reaped: 1,
            skipped: 0
        }
    );
    assert_eq!(registry.remaining(), Vec::<i64>::new());
}

#[tokio::test]
async fn never_kills_a_launch_pid_reused_by_a_bystander_but_prunes_it() {
    let registry = FakeRegistry::new(vec![launch(5000)]);
    let (kill, calls) = recording_kill(true);
    let result = sweep_stray_children(
        &*registry,
        &deps(
            constant_command("/usr/bin/postgres -D /data"),
            constant_cwd(Some("/var/lib/postgres")),
            kill,
        ),
    )
    .await;
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
