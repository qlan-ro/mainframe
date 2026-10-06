//! The orchestration credential's lifecycle: issued for every spawn, before
//! the CLI starts, and revoked when the chat's process is torn down.

use std::sync::{Arc, Mutex};

use mainframe_adapter_api::BoxFuture;
use mainframe_types::chat::ChatStatus;
use mainframe_types::orchestration::{OrchestrationMcpLaunch, SecretToken};

use super::tests::{FakeDeps, chat_over, manager};
use crate::orchestration_hooks::OrchestrationHooks;
use crate::test_support::FakeSession;

#[derive(Default)]
struct Recorder {
    calls: Mutex<Vec<String>>,
}

impl OrchestrationHooks for Recorder {
    fn issue_credential(&self, chat_id: &str, session_id: &str) -> Option<OrchestrationMcpLaunch> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("issue {chat_id} {session_id}"));
        Some(OrchestrationMcpLaunch {
            url: "http://127.0.0.1:31415/mcp".into(),
            token: SecretToken::new("secret".into()),
        })
    }
    fn revoke_credential(&self, chat_id: &str) {
        self.calls.lock().unwrap().push(format!("revoke {chat_id}"));
    }
    fn on_chat_stopping<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            self.calls
                .lock()
                .unwrap()
                .push(format!("stopping {chat_id}"));
        })
    }
}

#[tokio::test]
async fn every_spawn_carries_a_fresh_credential_and_stop_revokes_it() {
    let deps = FakeDeps::new(chat_over("c1", None, ChatStatus::Active), Vec::new());
    let session = FakeSession::with_activity(false, None);
    deps.set_session_to_return(session.clone());
    deps.allow_build_sink();
    let mgr = manager(deps.clone());
    let recorder = Arc::new(Recorder::default());
    mgr.orchestration().attach(recorder.clone());

    mgr.start_chat("c1").await;

    let options = session.spawn_options.lock().unwrap().clone();
    let launch = options
        .and_then(|o| o.orchestration_mcp)
        .expect("the spawn carries the credential");
    assert_eq!(launch.token.expose(), "secret");
    assert!(recorder.calls.lock().unwrap()[0].starts_with("issue c1 "));

    mgr.end_chat("c1").await;
    assert!(
        recorder
            .calls
            .lock()
            .unwrap()
            .contains(&"revoke c1".to_string())
    );
}

#[tokio::test]
async fn a_manager_without_hooks_spawns_without_the_tools() {
    let deps = FakeDeps::new(chat_over("c1", None, ChatStatus::Active), Vec::new());
    let session = FakeSession::with_activity(false, None);
    deps.set_session_to_return(session.clone());
    deps.allow_build_sink();
    let mgr = manager(deps.clone());

    mgr.start_chat("c1").await;

    let options = session.spawn_options.lock().unwrap().clone();
    assert!(options.is_some_and(|o| o.orchestration_mcp.is_none()));
}
