use super::*;

#[tokio::test]
async fn hydrates_a_running_task_when_lsof_finds_a_writer() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_writers(&tracker, &[777]);
    let sp = new_spool();
    let fp = sp.place_file(&sp.encoded_project, "sess1", "tkid01.output");
    reconcile_under(
        &tracker,
        snapshot(vec![make_chat("sess1", None, "p1")], &sp.project_path),
        Path::new(&sp.root),
    )
    .await;

    let list = tracker.list("chat-sess1");
    assert_eq!(list.len(), 1);
    let t = &list[0];
    assert_eq!(t.status, BackgroundTaskStatus::Running);
    assert_eq!(t.recovered, Some(true));
    assert_eq!(t.output_path.as_deref(), Some(fp.as_str()));
    assert_eq!(t.ended_at, None);
    // started_at is the file's ctime.
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
    reconcile_under(
        &tracker,
        snapshot(vec![make_chat("sess1", None, "p1")], &sp.project_path),
        Path::new(&sp.root),
    )
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
    let mut rx = tracker.subscribe();
    reconcile_under(
        &tracker,
        snapshot(
            vec![
                make_chat("sess-running", None, "p1"),
                make_chat("sess-stopped", None, "p1"),
            ],
            &sp.project_path,
        ),
        Path::new(&sp.root),
    )
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
async fn skips_unknown_vendor_session_id() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_writers(&tracker, &[]);
    let sp = new_spool();
    sp.place_file(&sp.encoded_project, "sess-other", "tkid01.output");
    reconcile_under(
        &tracker,
        snapshot(vec![make_chat("sess-known", None, "p1")], &sp.project_path),
        Path::new(&sp.root),
    )
    .await;
    assert!(tracker.list("chat-sess-known").is_empty());
}

#[tokio::test]
async fn skips_when_encoded_cwd_does_not_match() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_writers(&tracker, &[]);
    let sp = new_spool();
    sp.place_file("-fake-spoof", "sess1", "tkid01.output");
    reconcile_under(
        &tracker,
        snapshot(vec![make_chat("sess1", None, "p1")], &sp.project_path),
        Path::new(&sp.root),
    )
    .await;
    assert!(tracker.list("chat-sess1").is_empty());
}

#[tokio::test]
async fn rejects_symlinks_via_lstat() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_writers(&tracker, &[]);
    let sp = new_spool();
    sp.place_symlink(&sp.encoded_project, "sess1", "tkid01.output");
    reconcile_under(
        &tracker,
        snapshot(vec![make_chat("sess1", None, "p1")], &sp.project_path),
        Path::new(&sp.root),
    )
    .await;
    assert!(tracker.list("chat-sess1").is_empty());
}

#[tokio::test]
async fn skips_invalid_task_id_basenames() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_writers(&tracker, &[]);
    let sp = new_spool();
    sp.place_file(&sp.encoded_project, "sess1", "BAD..ID.output");
    reconcile_under(
        &tracker,
        snapshot(vec![make_chat("sess1", None, "p1")], &sp.project_path),
        Path::new(&sp.root),
    )
    .await;
    assert!(tracker.list("chat-sess1").is_empty());
}

#[tokio::test]
async fn skips_a_session_dir_symlinked_out_of_the_spool() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_writers(&tracker, &[]);
    let sp = new_spool();
    let elsewhere = tempdir().unwrap();
    let tasks = elsewhere.path().join("tasks");
    std::fs::create_dir_all(&tasks).unwrap();
    std::fs::write(tasks.join("tkid01.output"), b"x").unwrap();
    let cwd_dir = Path::new(&sp.root).join(&sp.encoded_project);
    std::fs::create_dir_all(&cwd_dir).unwrap();
    std::os::unix::fs::symlink(elsewhere.path(), cwd_dir.join("sess1")).unwrap();
    reconcile_under(
        &tracker,
        snapshot(vec![make_chat("sess1", None, "p1")], &sp.project_path),
        Path::new(&sp.root),
    )
    .await;
    assert!(tracker.list("chat-sess1").is_empty());
}

#[tokio::test]
async fn skips_archived_chats() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_writers(&tracker, &[]);
    let sp = new_spool();
    sp.place_file(&sp.encoded_project, "sess1", "tkid01.output");
    let mut chat = make_chat("sess1", None, "p1");
    chat.status = ChatStatus::Archived;
    reconcile_under(
        &tracker,
        snapshot(vec![chat], &sp.project_path),
        Path::new(&sp.root),
    )
    .await;
    assert!(tracker.list("chat-sess1").is_empty());
}

#[tokio::test]
async fn a_failed_writer_probe_does_not_adopt_a_stopped_task() {
    let tracker = BackgroundTaskTracker::new();
    set_lsof_for_tests(
        &tracker.process,
        Arc::new(|_| Box::pin(async { Err(crate::lsof::LsofError::TimedOut) })),
    );
    let sp = new_spool();
    sp.place_file(&sp.encoded_project, "sess1", "tkid01.output");
    reconcile_under(
        &tracker,
        snapshot(vec![make_chat("sess1", None, "p1")], &sp.project_path),
        Path::new(&sp.root),
    )
    .await;
    assert!(tracker.list("chat-sess1").is_empty());
}
