use super::*;

#[tokio::test]
async fn hydrates_a_running_task_when_lsof_finds_a_writer() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_writers(&tracker, &[777]);
    let sp = new_spool();
    let fp = sp.place_file(&sp.encoded_project, "sess1", "tkid01.output");
    let db = MockDb {
        chats: vec![make_chat("sess1", None, "p1")],
        project_path: sp.project_path.clone(),
    };
    reconcile_background_tasks(ReconcileDeps {
        tracker: &tracker,
        db: &db,
        spool_root: Some(sp.root.clone()),
        validator: Some(Arc::new(AlwaysValid)),
    })
    .await;

    let list = tracker.list("chat-sess1");
    assert_eq!(list.len(), 1);
    let t = &list[0];
    assert_eq!(t.status, BackgroundTaskStatus::Running);
    assert_eq!(t.recovered, Some(true));
    assert_eq!(t.output_path.as_deref(), Some(fp.as_str()));
    assert_eq!(t.ended_at, None);
    // startedAt == the file's real ctime.
    let md = std::fs::metadata(&fp).unwrap();
    assert_eq!(t.started_at, ctime_ms(&md));
    assert_eq!(tracker.get_pid("chat-sess1", "tkid01"), Some(777));
}

#[tokio::test]
async fn marks_stopped_when_no_writer_ended_at_is_mtime() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_writers(&tracker, &[]);
    let sp = new_spool();
    let fp = sp.place_file(&sp.encoded_project, "sess1", "tkid01.output");
    let db = MockDb {
        chats: vec![make_chat("sess1", None, "p1")],
        project_path: sp.project_path.clone(),
    };
    reconcile_background_tasks(ReconcileDeps {
        tracker: &tracker,
        db: &db,
        spool_root: Some(sp.root.clone()),
        validator: Some(Arc::new(AlwaysValid)),
    })
    .await;
    let t = tracker.list("chat-sess1").into_iter().next().unwrap();
    assert_eq!(t.status, BackgroundTaskStatus::Stopped);
    let md = std::fs::metadata(&fp).unwrap();
    assert_eq!(t.ended_at, Some(mtime_ms(&md)));
    assert_eq!(t.summary.as_deref(), Some("recovered after daemon restart"));
}

#[tokio::test]
async fn emits_events_for_recovered_tasks() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_writers_for_path(&tracker, "run001", &[777]);
    let sp = new_spool();
    sp.place_file(&sp.encoded_project, "sess-running", "run001.output");
    sp.place_file(&sp.encoded_project, "sess-stopped", "stop01.output");
    let db = MockDb {
        chats: vec![
            make_chat("sess-running", None, "p1"),
            make_chat("sess-stopped", None, "p1"),
        ],
        project_path: sp.project_path.clone(),
    };
    let mut rx = tracker.subscribe();
    reconcile_background_tasks(ReconcileDeps {
        tracker: &tracker,
        db: &db,
        spool_root: Some(sp.root.clone()),
        validator: Some(Arc::new(AlwaysValid)),
    })
    .await;
    // Walk/readdir order is not deterministic across platforms, so assert as a
    // set.
    let mut events = drain(&mut rx);
    events.sort();
    assert_eq!(
        events,
        vec![
            (
                "ended".to_string(),
                "chat-sess-stopped".to_string(),
                "stop01".to_string()
            ),
            (
                "started".to_string(),
                "chat-sess-running".to_string(),
                "run001".to_string()
            ),
        ]
    );
}

#[tokio::test]
async fn skips_unknown_claude_session_id() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_writers(&tracker, &[]);
    let sp = new_spool();
    sp.place_file(&sp.encoded_project, "sess-other", "tkid01.output");
    let db = MockDb {
        chats: vec![make_chat("sess-known", None, "p1")],
        project_path: sp.project_path.clone(),
    };
    reconcile_background_tasks(ReconcileDeps {
        tracker: &tracker,
        db: &db,
        spool_root: Some(sp.root.clone()),
        validator: Some(Arc::new(AlwaysValid)),
    })
    .await;
    assert!(tracker.list("chat-sess-known").is_empty());
}

#[tokio::test]
async fn skips_when_encoded_cwd_does_not_match() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_writers(&tracker, &[]);
    let sp = new_spool();
    sp.place_file("-fake-spoof", "sess1", "tkid01.output");
    let db = MockDb {
        chats: vec![make_chat("sess1", None, "p1")],
        project_path: sp.project_path.clone(),
    };
    reconcile_background_tasks(ReconcileDeps {
        tracker: &tracker,
        db: &db,
        spool_root: Some(sp.root.clone()),
        validator: Some(Arc::new(AlwaysValid)),
    })
    .await;
    assert!(tracker.list("chat-sess1").is_empty());
}

#[tokio::test]
async fn rejects_symlinks_via_lstat() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_writers(&tracker, &[]);
    let sp = new_spool();
    sp.place_symlink(&sp.encoded_project, "sess1", "tkid01.output");
    let db = MockDb {
        chats: vec![make_chat("sess1", None, "p1")],
        project_path: sp.project_path.clone(),
    };
    reconcile_background_tasks(ReconcileDeps {
        tracker: &tracker,
        db: &db,
        spool_root: Some(sp.root.clone()),
        validator: Some(Arc::new(AlwaysValid)),
    })
    .await;
    assert!(tracker.list("chat-sess1").is_empty());
}

#[tokio::test]
async fn skips_invalid_task_id_basenames() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_writers(&tracker, &[]);
    let sp = new_spool();
    sp.place_file(&sp.encoded_project, "sess1", "BAD..ID.output");
    let db = MockDb {
        chats: vec![make_chat("sess1", None, "p1")],
        project_path: sp.project_path.clone(),
    };
    reconcile_background_tasks(ReconcileDeps {
        tracker: &tracker,
        db: &db,
        spool_root: Some(sp.root.clone()),
        validator: Some(Arc::new(AlwaysValid)),
    })
    .await;
    assert!(tracker.list("chat-sess1").is_empty());
}

#[tokio::test]
async fn respects_the_injected_spool_validator() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_writers(&tracker, &[]);
    let sp = new_spool();
    let fp = sp.place_file(&sp.encoded_project, "sess1", "tkid01.output");
    let db = MockDb {
        chats: vec![make_chat("sess1", None, "p1")],
        project_path: sp.project_path.clone(),
    };
    let calls = Arc::new(Mutex::new(Vec::new()));
    let validator = Arc::new(RecordingValidator {
        result: false,
        calls: calls.clone(),
    });
    reconcile_background_tasks(ReconcileDeps {
        tracker: &tracker,
        db: &db,
        spool_root: Some(sp.root.clone()),
        validator: Some(validator),
    })
    .await;
    assert_eq!(
        calls.lock().unwrap().as_slice(),
        &[(fp, "tkid01".to_string())]
    );
    assert!(tracker.list("chat-sess1").is_empty());
}
