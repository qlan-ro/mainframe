use super::*;
#[tokio::test]
async fn stop_background_task_returns_unavailable_when_stdin_destroyed() {
    let s = session();
    s.set_child_for_test(dummy_child());
    let (tx, rx) = StdinTx::channel(8);
    drop(rx); // receiver gone => tx.is_closed() == destroyed
    s.set_stdin_for_test(Some(tx));
    let r = s.stop_background_task("task-2".to_string()).await.unwrap();
    assert!(!r.ok);
    assert_eq!(r.error.as_deref(), Some("stdin unavailable"));
}

#[tokio::test]
async fn stop_background_task_error_on_error_envelope() {
    let s = session();
    let mut rx = spawned_with_stdin(&s);
    let s2 = s.clone();
    let pending = tokio::spawn(async move { s2.stop_background_task("task-4b".to_string()).await });
    let payload = loop {
        tokio::task::yield_now().await;
        if let Ok(bytes) = rx.try_recv() {
            break serde_json::from_slice::<Value>(&bytes).unwrap();
        }
    };
    let request_id = payload["request_id"].as_str().unwrap();
    s.control.resolve(
        request_id,
        Some(json!({ "request_id": request_id, "subtype": "error", "error": "no such task" })),
    );
    assert_eq!(
        pending.await.unwrap().unwrap(),
        StopBackgroundTaskResult {
            ok: false,
            error: Some("no such task".to_string())
        }
    );
}

#[tokio::test]
async fn kill_resolves_only_after_child_emits_close() {
    let s = session();
    let (child, ctrl) = test_child();
    s.set_child_for_test(child);
    let s2 = s.clone();
    let mut fut = Box::pin(async move { s2.kill().await });

    tokio::select! {
        _ = &mut fut => panic!("kill resolved before close"),
        _ = tokio::time::sleep(Duration::from_millis(30)) => {}
    }
    assert!(ctrl.signals.lock().unwrap().contains(&Signal::Term));

    ctrl.trigger_close();
    tokio::time::timeout(Duration::from_secs(1), fut)
        .await
        .expect("kill resolves after close")
        .unwrap();
    assert!(s.state().child.is_none());
}

#[tokio::test]
async fn stop_background_task_returns_unavailable_when_no_stdin() {
    let s = session();
    s.set_child_for_test(dummy_child());
    let r = s.stop_background_task("task-1".to_string()).await.unwrap();
    assert!(!r.ok);
    assert_eq!(r.error.as_deref(), Some("stdin unavailable"));
}

#[tokio::test]
async fn stop_background_task_ok_on_success_envelope() {
    let s = session();
    let mut rx = spawned_with_stdin(&s);
    let s2 = s.clone();
    let pending = tokio::spawn(async move { s2.stop_background_task("task-4".to_string()).await });
    let payload = loop {
        tokio::task::yield_now().await;
        if let Ok(bytes) = rx.try_recv() {
            break serde_json::from_slice::<Value>(&bytes).unwrap();
        }
    };
    let request_id = payload["request_id"].as_str().unwrap();
    assert!(s.control.resolve(
        request_id,
        Some(json!({ "request_id": request_id, "subtype": "success", "response": {} }))
    ));
    assert_eq!(
        pending.await.unwrap().unwrap(),
        StopBackgroundTaskResult {
            ok: true,
            error: None
        }
    );
}

#[tokio::test(start_paused = true)]
async fn kill_falls_back_to_sigkill_after_3s() {
    let s = session();
    let (child, ctrl) = test_child();
    s.set_child_for_test(child);
    let s2 = s.clone();
    let handle = tokio::spawn(async move { s2.kill().await });
    tokio::task::yield_now().await;
    tokio::time::advance(Duration::from_millis(3000)).await;
    tokio::task::yield_now().await;
    handle.await.unwrap().unwrap();
    let signals = ctrl.signals.lock().unwrap();
    assert!(signals.contains(&Signal::Term));
    assert!(signals.contains(&Signal::Kill));
}

#[tokio::test(start_paused = true)]
async fn stop_background_task_times_out_after_5s() {
    let s = session();
    let mut _rx = spawned_with_stdin(&s);
    let s2 = s.clone();
    let handle = tokio::spawn(async move { s2.stop_background_task("task-3".to_string()).await });
    tokio::task::yield_now().await;
    tokio::time::advance(Duration::from_millis(5001)).await;
    let r = handle.await.unwrap().unwrap();
    assert!(!r.ok);
    assert_eq!(r.error.as_deref(), Some("timeout"));
}

#[tokio::test]
async fn stop_background_task_writes_stop_task_control_request() {
    let s = session();
    let mut rx = spawned_with_stdin(&s);
    let s2 = s.clone();
    let pending = tokio::spawn(async move { s2.stop_background_task("task-5".to_string()).await });
    let payload = loop {
        tokio::task::yield_now().await;
        if let Ok(bytes) = rx.try_recv() {
            break serde_json::from_slice::<Value>(&bytes).unwrap();
        }
    };
    assert_eq!(payload["type"], "control_request");
    assert_eq!(payload["request"]["subtype"], "stop_task");
    assert_eq!(payload["request"]["task_id"], "task-5");
    let request_id = payload["request_id"].as_str().unwrap();
    s.control.resolve(
        request_id,
        Some(json!({ "request_id": request_id, "subtype": "success", "response": {} })),
    );
    pending.await.unwrap().unwrap();
}
