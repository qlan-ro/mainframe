//! The idle history release's skip rules: every chat that is busy, waiting,
//! viewed, or whose history the transcript cannot give back keeps it.

use super::*;

#[tokio::test]
async fn a_working_chat_or_a_running_turn_keeps_its_history() {
    let working = fixture_with(60 * MINUTE, |chat| {
        chat.process_state = Some(Some(ProcessState::Working));
    });
    scan(&working.mgr).await;
    assert!(holds_history(&working.mgr), "working");

    let turn = fixture();
    turn.mgr
        .shared
        .active("c1")
        .unwrap()
        .lock()
        .unwrap()
        .running_since_ms = Some(now_ms());
    scan(&turn.mgr).await;
    assert!(holds_history(&turn.mgr), "a turn is running");

    let accepted = fixture();
    accepted
        .mgr
        .shared
        .active("c1")
        .unwrap()
        .lock()
        .unwrap()
        .turn_started_at = Some(now_ms());
    scan(&accepted.mgr).await;
    assert!(holds_history(&accepted.mgr), "a prompt was accepted");
}

#[tokio::test]
async fn a_pending_permission_keeps_the_history() {
    let f = fixture();
    let sink = f.mgr.event_handler.build_sink("c1", None);
    sink.on_permission(mainframe_types::adapter::ControlRequest {
        request_id: "req_1".to_string(),
        tool_name: "Bash".to_string(),
        tool_use_id: "toolu_1".to_string(),
        input: HashMap::new(),
        suggestions: Vec::new(),
        decision_reason: None,
        options: None,
    });

    scan(&f.mgr).await;

    assert!(holds_history(&f.mgr));
}

#[tokio::test]
async fn a_queued_message_keeps_the_history() {
    let f = fixture();
    f.mgr
        .shared
        .queued_refs
        .lock()
        .unwrap()
        .push(QueuedMessageRef {
            delivery: None,
            pause_reason: None,
            message_id: "q1".to_string(),
            chat_id: "c1".to_string(),
            uuid: "u1".to_string(),
            content: "later".to_string(),
            attachment_ids: None,
            timestamp: mainframe_types::time::now_iso8601(),
            steered: None,
        });

    scan(&f.mgr).await;

    assert!(holds_history(&f.mgr));
}

#[tokio::test]
async fn delegated_work_or_an_agent_outbox_keeps_the_history() {
    let delegating = fixture_with(60 * MINUTE, |chat| {
        chat.orchestration.has_running_delegated_task = true;
    });
    scan(&delegating.mgr).await;
    assert!(
        holds_history(&delegating.mgr),
        "a delegated task is running"
    );

    let parent = fixture_with(60 * MINUTE, |chat| {
        chat.orchestration
            .active_child_ids
            .push("child".to_string());
    });
    scan(&parent.mgr).await;
    assert!(holds_history(&parent.mgr), "a child chat is active");

    let task = fixture();
    task.mgr
        .lifecycle
        .orchestration()
        .attach(Arc::new(Hooks { busy: true }));
    scan(&task.mgr).await;
    assert!(
        holds_history(&task.mgr),
        "a nonterminal delegated task names the chat"
    );

    let outbox = fixture();
    outbox
        .mgr
        .lifecycle
        .orchestration()
        .attach(Arc::new(Hooks { busy: false }));
    scan(&outbox.mgr).await;
    assert!(
        holds_history(&outbox.mgr),
        "an agent message waits in its outbox"
    );
}

/// Orchestration as the server wires it: `busy` stands for a nonterminal
/// delegated task (no idle reservation); otherwise the chat has one agent
/// message waiting in its outbox.
struct Hooks {
    busy: bool,
}

impl crate::orchestration_hooks::OrchestrationHooks for Hooks {
    fn issue_credential(
        &self,
        _chat_id: &str,
        _session_id: &str,
    ) -> Option<mainframe_types::orchestration::OrchestrationMcpLaunch> {
        None
    }
    fn revoke_credential(&self, _chat_id: &str) {}
    fn on_chat_stopping<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async {})
    }
    fn reserve_idle_close<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, Option<Box<dyn Send>>> {
        let busy = self.busy;
        Box::pin(async move { (!busy).then(|| Box::new(()) as Box<dyn Send>) })
    }
    fn agent_outbox(
        &self,
        _chat_id: &str,
    ) -> Vec<mainframe_types::orchestration::AgentOutboxEntry> {
        if self.busy {
            return Vec::new();
        }
        vec![mainframe_types::orchestration::AgentOutboxEntry {
            entry_id: "ob1".into(),
            from_chat_id: "sender".into(),
            preview: "synthetic".into(),
        }]
    }
}

#[tokio::test]
async fn a_live_background_task_keeps_the_history() {
    use mainframe_types::background_task::*;
    let f = fixture();
    *f.deps.emitter.live_tasks.lock().unwrap() = vec![BackgroundTask {
        id: "task".into(),
        kind: BackgroundWorkKind::Bash,
        tool_name: BackgroundTaskToolName::Bash,
        tool_use_id: "tool".into(),
        command: "cmd".into(),
        description: "Running".into(),
        output_path: None,
        started_at: 1,
        ended_at: None,
        status: BackgroundTaskStatus::Running,
        last_output_line: None,
        summary: None,
        usage: None,
        recovered: None,
        workflow_name: None,
        run_id: None,
    }];

    scan(&f.mgr).await;

    assert!(holds_history(&f.mgr));
}

#[tokio::test]
async fn a_viewed_chat_keeps_the_history() {
    let f = fixture();
    f.viewers.0.lock().unwrap().insert("c1".to_string());

    scan(&f.mgr).await;

    assert!(holds_history(&f.mgr));
}

#[tokio::test]
async fn a_history_the_transcript_cannot_give_back_is_kept() {
    for edit in [
        (|chat: &mut Chat| chat.temporary = true) as fn(&mut Chat),
        |chat| chat.vendor_session_ephemeral = true,
        |chat| chat.transcript_missing = Some(true),
        |chat| chat.vendor_session_id = None,
    ] {
        let f = fixture_with(60 * MINUTE, edit);
        scan(&f.mgr).await;
        assert!(holds_history(&f.mgr));
    }
}

#[tokio::test]
async fn a_chat_still_due_an_idle_compaction_keeps_its_history() {
    let due = fixture();
    finish_real_run(&due, 30 * MINUTE).await;
    scan(&due.mgr).await;
    assert!(holds_history(&due.mgr), "the compaction reads the history");

    let past = fixture_with(70 * MINUTE, |_| {});
    finish_real_run(&past, 70 * MINUTE).await;
    scan(&past.mgr).await;
    assert!(
        !holds_history(&past.mgr),
        "the provider's cache window has passed"
    );
}

/// The scanner's selection and the release's own re-check are separate reads:
/// a chat that is viewed or wakes up after its selection must still stay.
#[tokio::test]
async fn the_release_rechecks_a_chat_that_woke_up_after_its_selection() {
    use crate::idle_scanner::HistoryReleaser as _;
    let idle_before = now_ms() - 10 * MINUTE;

    let viewed = fixture();
    viewed.viewers.0.lock().unwrap().insert("c1".to_string());
    releaser(&viewed.mgr).release("c1", idle_before).await;
    assert!(holds_history(&viewed.mgr), "viewed since its selection");

    let used = fixture();
    used.mgr.lifecycle.touch("c1");
    releaser(&used.mgr).release("c1", idle_before).await;
    assert!(holds_history(&used.mgr), "used since its selection");

    let idle = fixture();
    releaser(&idle.mgr).release("c1", idle_before).await;
    assert!(!holds_history(&idle.mgr), "still idle: released");
}

fn releaser(mgr: &ChatManager) -> ChatRelease {
    ChatRelease::new(
        mgr.shared.clone(),
        mgr.lifecycle.clone(),
        mgr.teardown.clone(),
    )
}
