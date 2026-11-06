use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use mainframe_automations::ports::{
    AgentOutcome, AgentPort, AgentRequest, AutomationEvent, CuratedEvent, EventSink, EventSource,
    Notification, NotificationLinks, Notifier, RunSummary, RunTriggerSummary, WorktreeRequest,
};
use mainframe_chat::chat_manager::SendError;
use mainframe_chat::config_manager::ConfigError;
use mainframe_db::DatabaseManager;
use mainframe_services::push::PushService;
use mainframe_types::BoxFuture;
use mainframe_types::automation::{AutomationRunStatus, AutomationTriggerKind};
use mainframe_types::chat::Chat;
use mainframe_types::events::{ChatUpdatedReason, DaemonEvent};
use tokio::sync::broadcast;

use crate::ctx::GitFactory;
use crate::db::Db;

use super::agent::DaemonAgentPort;
use super::bridges::{DaemonEventSink, DaemonEventSource, DaemonNotifier, map_automation_event};
use super::chat_port::AgentChatPort;

#[derive(Default)]
struct FakeChatPort {
    calls: StdMutex<Vec<String>>,
    fail_send: bool,
}

impl FakeChatPort {
    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }
    fn record(&self, call: String) {
        self.calls.lock().unwrap().push(call);
    }
}

impl AgentChatPort for FakeChatPort {
    fn create_chat<'a>(
        &'a self,
        project_id: &'a str,
        adapter_id: &'a str,
        model: Option<&'a str>,
        permission_mode: Option<&'a str>,
        branch_name: Option<&'a str>,
        automation_run_id: &'a str,
    ) -> BoxFuture<'a, Result<String, mainframe_chat::lifecycle_manager::LifecycleError>> {
        self.record(format!(
            "create:{project_id}:{adapter_id}:{}:{}:{}:{automation_run_id}",
            model.unwrap_or("-"),
            permission_mode.unwrap_or("-"),
            branch_name.unwrap_or("-"),
        ));
        Box::pin(async { Ok("chat_1".to_string()) })
    }

    fn enable_or_reuse_worktree<'a>(
        &'a self,
        chat_id: &'a str,
        base_branch: &'a str,
        branch_name: &'a str,
    ) -> BoxFuture<'a, Result<(), ConfigError>> {
        self.record(format!("worktree:{chat_id}:{base_branch}:{branch_name}"));
        Box::pin(async { Ok(()) })
    }

    fn send_message<'a>(
        &'a self,
        chat_id: &'a str,
        content: &'a str,
    ) -> BoxFuture<'a, Result<(), SendError>> {
        self.record(format!("send:{chat_id}:{content}"));
        let fail = self.fail_send;
        let chat_id = chat_id.to_string();
        Box::pin(async move {
            if fail {
                Err(SendError::NotRunning(chat_id))
            } else {
                Ok(())
            }
        })
    }

    fn last_assistant_text<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, String> {
        Box::pin(async { "final answer".to_string() })
    }

    fn interrupt<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        self.record(format!("interrupt:{chat_id}"));
        Box::pin(async {})
    }
}

fn mem_db() -> Db {
    Db::spawn(|| DatabaseManager::open(std::path::Path::new(":memory:"))).unwrap()
}

fn agent_port(
    fake: Arc<FakeChatPort>,
    broadcast: broadcast::Sender<DaemonEvent>,
) -> DaemonAgentPort {
    DaemonAgentPort::new(fake, broadcast, mem_db(), GitFactory)
}

fn request(project_id: Option<&str>) -> AgentRequest {
    AgentRequest {
        prompt: "do the thing".to_string(),
        adapter_id: "claude".to_string(),
        model: Some("sonnet".to_string()),
        permission_mode: None,
        project_id: project_id.map(str::to_string),
        run_id: "run-1".to_string(),
        worktree: None,
        auto_approve: None,
        timeout_minutes: None,
        expects: vec![],
        attachments: vec![],
    }
}

fn chat(id: &str) -> Chat {
    let mut chat = mainframe_types::chat::Chat::unpersisted(&mainframe_types::chat::NewChat {
        project_id: "p1".to_string(),
        adapter_id: "claude".to_string(),
        ..Default::default()
    });
    chat.id = id.to_string();
    chat
}

fn updated(id: &str, reason: Option<ChatUpdatedReason>) -> DaemonEvent {
    DaemonEvent::ChatUpdated {
        chat: chat(id),
        reason,
    }
}

#[tokio::test]
async fn start_creates_a_chat_and_sends_the_prompt() {
    let fake = Arc::new(FakeChatPort::default());
    let (tx, _rx) = broadcast::channel(16);
    let port = agent_port(fake.clone(), tx);

    let handle = port.start(request(Some("p1"))).await.unwrap();
    assert_eq!(handle.chat_id, "chat_1");
    assert_eq!(
        fake.calls(),
        vec![
            "create:p1:claude:sonnet:-:-:run-1".to_string(),
            "send:chat_1:do the thing".to_string(),
        ]
    );
}

#[tokio::test]
async fn start_enables_a_worktree_with_the_step_base_branch() {
    let fake = Arc::new(FakeChatPort::default());
    let (tx, _rx) = broadcast::channel(16);
    let port = agent_port(fake.clone(), tx);

    let mut req = request(Some("p1"));
    req.worktree = Some(WorktreeRequest {
        base_branch: Some("main".to_string()),
        branch_name: "auto/spike".to_string(),
    });
    port.start(req).await.unwrap();
    assert_eq!(
        fake.calls(),
        vec![
            "create:p1:claude:sonnet:-:auto/spike:run-1".to_string(),
            "worktree:chat_1:main:auto/spike".to_string(),
            "send:chat_1:do the thing".to_string(),
        ]
    );
}

#[tokio::test]
async fn start_without_any_project_fails_with_a_clear_error() {
    let fake = Arc::new(FakeChatPort::default());
    let (tx, _rx) = broadcast::channel(16);
    let port = agent_port(fake.clone(), tx);

    let err = port.start(request(None)).await.unwrap_err();
    assert!(err.to_string().contains("requires a projectId"));
    assert!(fake.calls().is_empty());
}

#[tokio::test]
async fn watch_resolves_on_the_matching_terminal_chat_updated() {
    let fake = Arc::new(FakeChatPort::default());
    let (tx, _rx) = broadcast::channel(16);
    let port = agent_port(fake, tx.clone());

    let watching = tokio::spawn(async move { port.watch("chat_1").await });
    mainframe_runtime::test_support::poll_until(
        Duration::from_secs(10),
        std::time::Duration::from_millis(5),
        async || !(tx.receiver_count() < 2),
    )
    .await
    .expect("agent watch subscribed");
    tx.send(updated("other", Some(ChatUpdatedReason::Completed)))
        .unwrap();
    tx.send(updated("chat_1", None)).unwrap();
    tx.send(updated("chat_1", Some(ChatUpdatedReason::Completed)))
        .unwrap();

    let outcome = watching.await.unwrap().unwrap();
    assert_eq!(
        outcome,
        AgentOutcome::Completed {
            final_text: "final answer".to_string()
        }
    );
}

#[tokio::test]
async fn watch_maps_error_and_interrupt_reasons() {
    for (reason, expected) in [
        (ChatUpdatedReason::Error, AgentOutcome::Errored),
        (ChatUpdatedReason::Interrupted, AgentOutcome::Interrupted),
    ] {
        let fake = Arc::new(FakeChatPort::default());
        let (tx, _rx) = broadcast::channel(16);
        let port = agent_port(fake, tx.clone());
        let watching = tokio::spawn(async move { port.watch("chat_1").await });
        mainframe_runtime::test_support::poll_until(
            Duration::from_secs(10),
            std::time::Duration::from_millis(5),
            async || !(tx.receiver_count() < 2),
        )
        .await
        .expect("agent watch subscribed");
        tx.send(updated("chat_1", Some(reason))).unwrap();
        assert_eq!(watching.await.unwrap().unwrap(), expected);
    }
}

#[tokio::test]
async fn a_send_that_finishes_before_watch_is_not_missed() {
    // start() subscribes before the send, so a terminal event that fires
    // before watch() is buffered in the pending receiver.
    let fake = Arc::new(FakeChatPort::default());
    let (tx, _rx) = broadcast::channel(16);
    let port = agent_port(fake, tx.clone());

    port.start(request(Some("p1"))).await.unwrap();
    tx.send(updated("chat_1", Some(ChatUpdatedReason::Completed)))
        .unwrap();
    let outcome = port.watch("chat_1").await.unwrap();
    assert!(matches!(outcome, AgentOutcome::Completed { .. }));
}

#[tokio::test]
async fn retry_sends_the_correction_into_the_same_chat() {
    let fake = Arc::new(FakeChatPort::default());
    let (tx, _rx) = broadcast::channel(16);
    let port = Arc::new(agent_port(fake.clone(), tx.clone()));

    let retrying = {
        let port = port.clone();
        tokio::spawn(async move { port.retry("chat_1", "fix the JSON").await })
    };
    mainframe_runtime::test_support::poll_until(
        Duration::from_secs(10),
        std::time::Duration::from_millis(5),
        async || !(tx.receiver_count() < 2),
    )
    .await
    .expect("agent watch subscribed");
    tx.send(updated("chat_1", Some(ChatUpdatedReason::Completed)))
        .unwrap();
    retrying.await.unwrap().unwrap();
    assert_eq!(fake.calls(), vec!["send:chat_1:fix the JSON".to_string()]);
}

#[tokio::test]
async fn failed_send_surfaces_and_clears_the_pending_receiver() {
    let fake = Arc::new(FakeChatPort {
        fail_send: true,
        ..Default::default()
    });
    let (tx, _rx) = broadcast::channel(16);
    let port = agent_port(fake, tx);
    let err = port.start(request(Some("p1"))).await.unwrap_err();
    assert_eq!(err.to_string(), "Chat chat_1 not running");
}
