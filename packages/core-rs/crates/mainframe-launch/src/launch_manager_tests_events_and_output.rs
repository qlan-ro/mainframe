use super::*;

fn completion_recorder() -> (
    BroadcastFn,
    Arc<StdMutex<Vec<DaemonEvent>>>,
    tokio::sync::mpsc::UnboundedReceiver<()>,
) {
    let (record, events) = recorder();
    let (done, receiver) = tokio::sync::mpsc::unbounded_channel();
    let broadcast: BroadcastFn = Arc::new(move |event| {
        let stopped = matches!(
            &event,
            DaemonEvent::LaunchStatus {
                status: LaunchProcessStatus::Stopped,
                ..
            }
        );
        record(event);
        if stopped {
            let _ = done.send(()); // The test may already have finished.
        }
    });
    (broadcast, events, receiver)
}

async fn completed(receiver: &mut tokio::sync::mpsc::UnboundedReceiver<()>) {
    tokio::time::timeout(Duration::from_secs(10), receiver.recv())
        .await
        .expect("process exits after its output drains")
        .expect("completion event");
}

#[tokio::test]
async fn emits_effective_path_in_status_events() {
    let (broadcast, events, mut done) = completion_recorder();
    let manager = manager(broadcast);
    manager
        .start(&cfg("ep-test", "exit 0", None))
        .await
        .unwrap();
    completed(&mut done).await;
    let paths: Vec<String> = events
        .lock()
        .unwrap()
        .iter()
        .filter_map(|e| match e {
            DaemonEvent::LaunchStatus { effective_path, .. } => Some(effective_path.clone()),
            _ => None,
        })
        .collect();
    assert!(!paths.is_empty());
    assert!(paths.iter().all(|p| p == "/tmp"));
    manager.stop_all().await;
}

#[tokio::test]
async fn emits_effective_path_in_output_events() {
    let (broadcast, events, mut done) = completion_recorder();
    let manager = manager(broadcast);
    manager
        .start(&cfg("ep-out", "printf hi", None))
        .await
        .unwrap();
    completed(&mut done).await;
    let paths: Vec<String> = events
        .lock()
        .unwrap()
        .iter()
        .filter_map(|e| match e {
            DaemonEvent::LaunchOutput { effective_path, .. } => Some(effective_path.clone()),
            _ => None,
        })
        .collect();
    assert!(!paths.is_empty());
    assert!(paths.iter().all(|p| p == "/tmp"));
    manager.stop_all().await;
}

#[tokio::test]
async fn passes_env_vars_to_the_spawned_process() {
    let (broadcast, events, mut done) = completion_recorder();
    let manager = manager(broadcast);
    let mut config = cfg("env-test", "printf \"$MY_VAR\"", None);
    config.env = Some(
        [("MY_VAR".to_string(), "hello-from-env".to_string())]
            .into_iter()
            .collect(),
    );
    manager.start(&config).await.unwrap();
    completed(&mut done).await;
    assert!(
        output_events(&events)
            .iter()
            .any(|(_, d)| d.contains("hello-from-env"))
    );
    manager.stop_all().await;
}

#[tokio::test]
async fn retains_stdout_from_a_near_instant_exit_via_output_buffer() {
    let (broadcast, _events, mut done) = completion_recorder();
    let manager = manager(broadcast);
    manager
        .start(&cfg("echo-once", "printf 'hello-from-launch\\n'", None))
        .await
        .unwrap();
    completed(&mut done).await;
    let buffer = manager.get_output_buffer("echo-once");
    assert!(buffer.iter().any(|e| e.data.contains("hello-from-launch")));
}

#[tokio::test]
async fn resets_the_buffer_on_the_next_start() {
    let (broadcast, _events, mut done) = completion_recorder();
    let manager = manager(broadcast);
    manager
        .start(&cfg("echo-once", "printf 'first-run\\n'", None))
        .await
        .unwrap();
    completed(&mut done).await;
    assert!(
        manager
            .get_output_buffer("echo-once")
            .iter()
            .any(|e| e.data.contains("first-run"))
    );

    manager
        .start(&cfg("echo-once", "printf 'second-run\\n'", None))
        .await
        .unwrap();
    completed(&mut done).await;
    let buffer = manager.get_output_buffer("echo-once");
    assert!(buffer.iter().any(|e| e.data.contains("second-run")));
    assert!(!buffer.iter().any(|e| e.data.contains("first-run")));
}
