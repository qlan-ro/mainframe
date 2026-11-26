#[tokio::test]
async fn failed_shutdown_keeps_the_chat_and_its_session_until_a_later_success() {
    use std::sync::atomic::Ordering;

    let manager = ChatManager::new(FakeDeps::arc());
    let session = FakeSession::with_activity(true, Some(long_idle()));
    session.fail_kill.store(true, Ordering::SeqCst);
    let mut chat = test_chat("c1");
    chat.adapter_id = "codex".into();
    seed_active(&manager, "c1", chat, session.clone());

    manager.scan_idle_sessions().await;
    assert_eq!(session.kills(), 1);
    let live = manager.shared.active_chats.get("c1").unwrap();
    let stored = live.value().lock().unwrap().session.clone().unwrap();
    drop(live);
    let expected: std::sync::Arc<dyn mainframe_adapter_api::AdapterSession> = session.clone();
    assert!(std::sync::Arc::ptr_eq(&stored, &expected));

    session.fail_kill.store(false, Ordering::SeqCst);
    manager.scan_idle_sessions().await;
    assert_eq!(session.kills(), 2);
    assert!(!manager.shared.active_chats.contains_key("c1"));
}

#[cfg(unix)]
mod codex_resume {
    use super::*;
    use mainframe_adapter_codex::CodexSession;
    use mainframe_background_tasks::tracker::BackgroundTaskTracker;
    use mainframe_runtime::ResolvedPath;
    use mainframe_types::adapter::SessionOptions;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;
    use std::time::Duration;

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn immediate_send_after_failed_close_finishes_shutdown_and_resumes_codex() {
        let dir = tempfile::tempdir().unwrap();
        let capture = write_app_server(dir.path());
        let old = session(dir.path());
        old.spawn(None, None).await.unwrap();
        old.set_model("gpt-5.5".into()).await.unwrap();
        old.send_message("initial turn".into(), vec![], None)
            .await
            .unwrap();
        let (deps, manager, replacement) = seed_manager(dir.path(), old.clone());
        let finish_exit = time_out_close(&old).await;
        assert_closing_send_rejected(&old).await;

        let send = manager.send_message("c1", "deliver after resume", None, None);
        tokio::pin!(send);
        assert!(
            tokio::time::timeout(Duration::from_millis(50), &mut send)
                .await
                .is_err()
        );
        finish_exit.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(5), &mut send)
            .await
            .unwrap()
            .unwrap();

        assert!(!old.is_closing());
        assert_eq!(
            deps.created_sessions().last().unwrap().chat_id.as_deref(),
            Some("thread-1")
        );
        let capture = std::fs::read_to_string(capture).unwrap();
        assert_eq!(capture.matches(r#""method":"thread/resume""#).count(), 2);
        assert_eq!(capture.matches(r#""method":"turn/start""#).count(), 2);
        assert!(capture.contains(r#""text":"deliver after resume""#));
        assert!(!capture.contains("cannot write"));
        replacement.kill().await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn send_waiting_for_a_second_shutdown_timeout_is_definitely_undelivered() {
        let dir = tempfile::tempdir().unwrap();
        let capture = write_app_server(dir.path());
        let old = session(dir.path());
        old.spawn(None, None).await.unwrap();
        let (deps, manager, replacement) = seed_manager(dir.path(), old.clone());
        let finish_exit = time_out_close(&old).await;

        let error = manager
            .send_message("c1", "retry this prompt", None, None)
            .await
            .unwrap_err();
        finish_exit.send(()).unwrap();
        old.kill().await.unwrap();

        assert!(error.never_delivered());
        assert_eq!(
            error.to_string(),
            "The previous session is still shutting down (Codex app-server termination was not confirmed). Try again."
        );
        assert!(deps.created_sessions().is_empty());
        assert!(!replacement.is_spawned());
        assert!(
            !std::fs::read_to_string(capture)
                .unwrap()
                .contains("retry this prompt")
        );
    }

    async fn time_out_close(old: &CodexSession) -> std::sync::mpsc::Sender<()> {
        let (finish_exit, exit_blocked) = std::sync::mpsc::channel();
        let reaped = Arc::new(tokio::sync::Notify::new());
        let exited = reaped.clone();
        old.set_on_exit(Box::new(move || {
            exited.notify_one();
            tokio::task::block_in_place(|| {
                exit_blocked.recv_timeout(Duration::from_secs(15)).unwrap();
            });
        }));
        assert_eq!(
            old.kill().await.unwrap_err().to_string(),
            "Codex app-server termination was not confirmed"
        );
        tokio::time::timeout(Duration::from_secs(2), reaped.notified())
            .await
            .unwrap();
        finish_exit
    }

    async fn assert_closing_send_rejected(old: &Arc<CodexSession>) {
        assert!(old.is_closing());
        assert!(!old.is_spawned());
        let last_activity = old.last_activity_at();
        assert!(
            old.send_message("cannot write".into(), vec![], None)
                .await
                .is_err()
        );
        assert_eq!(old.last_activity_at(), last_activity);
        let tracked: Arc<dyn AdapterSession> = old.clone();
        assert_eq!(
            crate::idle_scanner::idle_since(Some(&tracked), i64::MAX),
            last_activity
        );
    }

    fn seed_manager(
        dir: &Path,
        old: Arc<CodexSession>,
    ) -> (Arc<FakeDeps>, ChatManager, Arc<CodexSession>) {
        let mut chat = test_chat("c1");
        chat.adapter_id = "codex".into();
        chat.vendor_session_id = Some("thread-1".into());
        chat.model = Some("gpt-5.5".into());
        let deps = FakeDeps::with_chats(vec![chat.clone()]);
        deps.set_project_path(dir.to_str().unwrap());
        let replacement = session(dir);
        deps.set_session_to_return(replacement.clone());
        let manager = ChatManager::new(deps.clone());
        seed_active(&manager, "c1", chat, old);
        (deps, manager, replacement)
    }

    fn session(dir: &Path) -> Arc<CodexSession> {
        let session = Arc::new(CodexSession::new(
            SessionOptions {
                project_path: dir.to_string_lossy().into_owned(),
                chat_id: Some("thread-1".into()),
                mainframe_chat_id: "c1".into(),
                session_file_path: None,
                fork_source: None,
            },
            None,
            ResolvedPath::from_value(format!("{}:/usr/bin:/bin", dir.display())),
            Arc::new(BackgroundTaskTracker::new()),
        ));
        session.set_transcript_present_override(true);
        session
    }

    fn write_app_server(dir: &Path) -> std::path::PathBuf {
        let executable = dir.join("codex");
        std::fs::write(&executable, r#"#!/bin/sh
while IFS= read -r line; do
  printf '%s\n' "$line" >> requests.jsonl
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
  case "$line" in
    *'"method":"initialize"'*) printf '{"id":%s,"result":{"userAgent":"codex/0.155.1"}}\n' "$id" ;;
    *'"method":"thread/resume"'*) printf '{"id":%s,"result":{"thread":{"id":"thread-1"},"model":"gpt-5.5"}}\n' "$id" ;;
    *'"method":"turn/start"'*) printf '{"id":%s,"result":{"turn":{"id":"turn-1","status":"in_progress"}}}\n' "$id" ;;
  esac
done
"#).unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        dir.join("requests.jsonl")
    }
}
