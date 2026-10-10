use super::*;
pub struct NullSink;
impl SessionSink for NullSink {
    fn on_init(&self, _session_id: &str) {}
    fn on_message(
        &self,
        _content: Vec<mainframe_types::chat::MessageContent>,
        _metadata: Option<mainframe_types::adapter::MessageMetadata>,
    ) {
    }
    fn on_tool_result(
        &self,
        _content: Vec<mainframe_types::chat::MessageContent>,
        _vendor_id: Option<String>,
    ) {
    }
    fn on_permission(&self, _request: mainframe_types::adapter::ControlRequest) {}
    fn on_result(&self, _data: mainframe_types::adapter::SessionResult) {}
    fn on_exit(&self, _code: Option<i32>) {}
    fn on_error(&self, _error: AdapterError) {}
    fn on_compact(&self, _vendor_id: Option<&str>) {}
    fn on_compact_start(&self) {}
    fn on_context_usage(&self, _usage: mainframe_types::adapter::ContextUsage) {}
    fn on_plan_file(&self, _file_path: &str) {}
    fn on_skill_file(&self, _entry: SkillFileEntry) {}
    fn on_queued_processed(&self, _uuid: &str) {}
    fn on_todo_update(&self, _todos: Vec<mainframe_types::chat::TodoItem>) {}
    fn on_pr_detected(&self, _pr: mainframe_types::adapter::DetectedPr) {}
    fn on_cli_message(&self, _text: &str) {}
    fn on_skill_loaded(&self, _entry: mainframe_adapter_api::LoadedSkill) {}
    fn on_subagent_child(
        &self,
        _parent_tool_use_id: &str,
        _blocks: Vec<mainframe_types::chat::MessageContent>,
    ) {
    }
}
pub use mainframe_runtime::process::Signal;
#[derive(Clone)]
pub struct ChildHandle {
    pub pid: u32,
    pub(super) signaller: Arc<dyn Fn(Signal) + Send + Sync>,
    pub(super) closed: Arc<Notify>,
    pub(super) exited: Arc<std::sync::atomic::AtomicBool>,
}

impl ChildHandle {
    pub(super) fn signal(&self, sig: Signal) {
        (self.signaller)(sig);
    }
    pub(super) fn exited(&self) -> bool {
        self.exited.load(Ordering::SeqCst)
    }
    pub(super) async fn wait_closed(&self) {
        loop {
            let n = self.closed.notified();
            if self.exited() {
                return;
            }
            n.await;
            if self.exited() {
                return;
            }
        }
    }
}

impl ClaudeSession {
    pub(super) fn bind_child(
        &self,
        pid: u32,
        process: &mainframe_runtime::process::ManagedProcess,
    ) -> ChildHandle {
        let process = process.clone();
        let handle = ChildHandle {
            pid,
            signaller: Arc::new(move |signal| process.signal(signal)),
            closed: Arc::new(Notify::new()),
            exited: Arc::new(AtomicBool::new(false)),
        };
        self.state().child = Some(handle.clone());
        self.shared.pid.store(pid, Ordering::SeqCst);
        self.set_status(AdapterProcessStatus::Starting);
        self.bump_last_activity();
        handle
    }
    pub(super) fn start_stdin(&self, stdin: Option<tokio::process::ChildStdin>) {
        let stdin_tx = mainframe_runtime::process::spawn_stdin_writer(stdin);
        *self.stdin_tx.lock_recover() = Some(stdin_tx);
    }
    pub(super) fn start_output<R: tokio::io::AsyncRead + Unpin + Send + 'static>(
        &self,
        reader: Option<R>,
        sink: Arc<dyn SessionSink>,
        handler: fn(&ClaudeSession, &[u8], &dyn SessionSink),
    ) -> Option<tokio::task::JoinHandle<()>> {
        let weak = self.weak_self.get().cloned();
        reader.map(|reader| {
            mainframe_runtime::process::spawn_chunk_pump(reader, move |bytes| {
                if let Some(session) = weak.as_ref().and_then(Weak::upgrade) {
                    handler(&session, bytes, &*sink);
                    true
                } else {
                    false
                }
            })
        })
    }
    pub(super) fn wait_for_exit(
        &self,
        exit: mainframe_runtime::process::ExitLatch,
        handle: ChildHandle,
        sink: Arc<dyn SessionSink>,
    ) {
        let weak = self.weak_self.get().cloned();
        let control = self.control.clone();
        tokio::spawn(async move {
            let code = exit.wait().await;
            handle.exited.store(true, Ordering::SeqCst);
            if let Some(session) = weak.as_ref().and_then(Weak::upgrade) {
                session.process_exited(&*sink);
            }
            control.drain_all_as_failed();
            handle.closed.notify_waiters();
            sink.on_exit(code);
            if let Some(session) = weak.as_ref().and_then(Weak::upgrade) {
                let guard = session.on_exit.lock_recover();
                if let Some(cb) = guard.as_ref() {
                    cb();
                }
            }
        });
    }
}
