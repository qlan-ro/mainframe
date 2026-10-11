//! Reaping a launch orphan by process group: SIGTERM to the group, the
//! SIGKILL escalation for a survivor, and the identity re-check that keeps
//! the escalation off a reused pid.

use super::*;

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
    assert_eq!(*calls.lock().unwrap(), vec![(5000, Signal::Term, true)]);
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
        vec![(5000, Signal::Term, true), (5000, Signal::Kill, true),]
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
    assert_eq!(*calls.lock().unwrap(), vec![(5000, Signal::Term, true)]);
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
    assert_eq!(*calls.lock().unwrap(), vec![(5000, Signal::Term, true)]);
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
