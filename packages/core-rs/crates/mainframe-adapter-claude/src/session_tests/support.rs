use super::*;
use tokio::sync::mpsc;

pub(super) fn spawn_env(proxy: Option<&CliProxyEnv>) -> HashMap<String, Option<String>> {
    build_spawn_command("claude", &[], "/tmp", "/usr/bin", proxy)
        .as_std()
        .get_envs()
        .map(|(k, v)| {
            (
                k.to_string_lossy().into_owned(),
                v.map(|v| v.to_string_lossy().into_owned()),
            )
        })
        .collect()
}

pub(super) fn session() -> Arc<ClaudeSession> {
    let s = Arc::new(ClaudeSession::new(
        SessionOptions {
            project_path: "/tmp".to_string(),
            chat_id: None,
            mainframe_chat_id: "test-chat-id".to_string(),
            session_file_path: None,
            fork_source: None,
        },
        None,
        Arc::new(BackgroundTaskTracker::new()),
        Arc::new(ClaudeWorkflowStore::new()),
        ResolvedPath::from_value("/usr/bin:/bin"),
    ));
    s.init_weak();
    s
}

pub(super) fn spawn_opts(permission_mode: Option<ExecutionMode>) -> SessionSpawnOptions {
    SessionSpawnOptions {
        model: None,
        permission_mode,
        plan_mode: None,
        executable_path: None,
        system_prompt: None,
        tuning: None,
        small_fast_model: None,
        default_model: None,
        no_persistence: None,
        orchestration_mcp: None,
    }
}

pub(super) fn mode_arg(args: &[String]) -> &str {
    let i = args.iter().position(|a| a == "--permission-mode").unwrap();
    &args[i + 1]
}

pub(super) fn dummy_child() -> ChildHandle {
    ChildHandle {
        pid: 12345,
        signaller: Arc::new(|_| {}),
        closed: Arc::new(Notify::new()),
        exited: Arc::new(std::sync::atomic::AtomicBool::new(false)),
    }
}
pub(super) fn spawned_with_stdin(s: &ClaudeSession) -> mpsc::UnboundedReceiver<Vec<u8>> {
    s.set_child_for_test(dummy_child());
    let (tx, rx) = mpsc::unbounded_channel();
    s.set_stdin_for_test(Some(tx));
    rx
}

pub(super) fn read_json(rx: &mut mpsc::UnboundedReceiver<Vec<u8>>) -> Value {
    let bytes = rx.try_recv().expect("a write was captured");
    serde_json::from_slice(&bytes).unwrap()
}

pub(super) struct TestChild {
    pub(super) exited: Arc<std::sync::atomic::AtomicBool>,
    pub(super) closed: Arc<Notify>,
    pub(super) signals: Arc<Mutex<Vec<Signal>>>,
}
impl TestChild {
    pub(super) fn trigger_close(&self) {
        self.exited.store(true, Ordering::SeqCst);
        self.closed.notify_waiters();
    }
}
pub(super) fn test_child() -> (ChildHandle, TestChild) {
    let exited = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let closed = Arc::new(Notify::new());
    let signals = Arc::new(Mutex::new(Vec::new()));
    let sig = signals.clone();
    let child = ChildHandle {
        pid: 99999,
        signaller: Arc::new(move |s| sig.lock().unwrap().push(s)),
        closed: closed.clone(),
        exited: exited.clone(),
    };
    (
        child,
        TestChild {
            exited,
            closed,
            signals,
        },
    )
}

#[path = "spawn.rs"]
mod spawn;

#[path = "controls.rs"]
mod controls;

#[path = "lifecycle.rs"]
mod lifecycle;
