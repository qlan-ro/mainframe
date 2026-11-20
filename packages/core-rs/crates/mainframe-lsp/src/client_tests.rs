use super::*;
use crate::LspManager;
use crate::test_fixtures::{bounded, echo_manager, script_manager, timeouts, wait_for};

const INITIALIZE_RESPONSE: &str =
    r#"{"jsonrpc":"2.0","id":1,"result":{"capabilities":{"hoverProvider":true}}}"#;

fn message(text: &str) -> Option<ClientEvent> {
    Some(ClientEvent::Message(text.to_owned()))
}

async fn spawn(manager: &LspManager) -> Arc<LspServerHandle> {
    manager.connect("p1", "typescript", "/tmp").await.unwrap()
}

/// A session over a fresh `cat` server whose cache holds an `initialize`
/// result, as after a first editor connected and disconnected.
async fn initialized_server(manager: &LspManager) -> Arc<LspServerHandle> {
    let handle = spawn(manager).await;
    let mut first = manager.attach(&handle);
    assert!(!first.is_reattach());
    first.forward(INITIALIZE_RESPONSE.to_owned()).await;
    assert_eq!(bounded(first.recv()).await, message(INITIALIZE_RESPONSE));
    assert_eq!(
        handle.initialize_result(),
        Some(serde_json::json!({ "capabilities": { "hoverProvider": true } }))
    );
    handle
}

#[tokio::test]
async fn a_reconnecting_session_replays_initialize_then_reaches_the_server() {
    let manager = echo_manager();
    let handle = initialized_server(&manager).await;

    let mut second = manager.attach(&handle);
    assert!(second.is_reattach());
    second
        .forward(r#"{"jsonrpc":"2.0","id":7,"method":"initialize","params":{}}"#.to_owned())
        .await;
    let Some(ClientEvent::Message(reply)) = bounded(second.recv()).await else {
        panic!("expected the cached initialize reply");
    };
    assert_eq!(
        serde_json::from_str::<Value>(&reply).unwrap(),
        serde_json::json!({ "jsonrpc": "2.0", "id": 7, "result": { "capabilities": { "hoverProvider": true } } })
    );
    second
        .forward(r#"{"jsonrpc":"2.0","method":"initialized","params":{}}"#.to_owned())
        .await;
    let hover = r#"{"jsonrpc":"2.0","id":8,"method":"textDocument/hover"}"#;
    second.forward(hover.to_owned()).await;
    // `cat` would echo `initialized` first had it been forwarded.
    assert_eq!(bounded(second.recv()).await, message(hover));
    manager.shutdown_all().await;
}

#[tokio::test]
async fn server_messages_wait_for_the_replay_to_finish() {
    let manager = echo_manager();
    let handle = initialized_server(&manager).await;
    let mut second = manager.attach(&handle);

    let log = r#"{"jsonrpc":"2.0","method":"window/logMessage"}"#;
    handle.write(log).await.unwrap();
    wait_for("the echo to be held", || handle.held_messages() == 1).await;
    assert!(second.events.try_recv().is_err());

    second
        .forward(r#"{"jsonrpc":"2.0","method":"initialized"}"#.to_owned())
        .await;
    assert_eq!(bounded(second.recv()).await, message(log));
    manager.shutdown_all().await;
}

#[tokio::test]
async fn a_replaced_session_closes_without_detaching_its_successor() {
    let manager = echo_manager();
    let handle = spawn(&manager).await;
    let mut first = manager.attach(&handle);
    let mut second = manager.attach(&handle);
    assert_eq!(
        bounded(first.recv()).await,
        Some(ClientEvent::Close {
            code: 1001,
            reason: "Replaced by new client"
        })
    );

    drop(first);
    assert!(!handle.has_idle_timer());
    let ping = r#"{"jsonrpc":"2.0","method":"ping"}"#;
    second.forward(ping.to_owned()).await;
    assert_eq!(bounded(second.recv()).await, message(ping));
    manager.shutdown_all().await;
}

#[tokio::test]
async fn detaching_rearms_the_idle_reaper() {
    let manager = echo_manager();
    let handle = spawn(&manager).await;
    assert!(handle.has_idle_timer());
    let client = manager.attach(&handle);
    assert!(!handle.has_idle_timer());
    drop(client);
    assert!(handle.has_idle_timer());
    manager.shutdown_all().await;
}

#[tokio::test]
async fn shutdown_closes_the_session() {
    let manager = echo_manager();
    let handle = spawn(&manager).await;
    let mut client = manager.attach(&handle);
    manager.shutdown_all().await;
    assert_eq!(
        bounded(client.recv()).await,
        Some(ClientEvent::Close {
            code: 1000,
            reason: "LSP server shut down"
        })
    );
    assert_eq!(bounded(client.recv()).await, None);

    // A socket that upgrades after the shutdown is closed at once.
    let mut late = manager.attach(&handle);
    assert_eq!(
        bounded(late.recv()).await,
        Some(ClientEvent::Close {
            code: 1001,
            reason: "LSP server exited"
        })
    );
}

#[tokio::test]
async fn a_server_exit_closes_the_session_and_frees_the_slot() {
    // Exits after reading its first byte.
    let manager = script_manager("head -c 1 >/dev/null", timeouts());
    let handle = spawn(&manager).await;
    let mut client = manager.attach(&handle);
    client.forward("{}".to_owned()).await;
    assert_eq!(
        bounded(client.recv()).await,
        Some(ClientEvent::Close {
            code: 1001,
            reason: "LSP server exited"
        })
    );
    assert!(manager.active_languages("p1").is_empty());
}

#[test]
fn replay_answers_initialize_requests_only() {
    assert!(matches!(
        classify_replay(r#"{"jsonrpc":"2.0","id":3,"method":"initialize"}"#),
        Replay::Initialize { id } if id == 3
    ));
    assert!(matches!(
        classify_replay(r#"{"jsonrpc":"2.0","id":null,"method":"initialize"}"#),
        Replay::Other
    ));
    assert!(matches!(
        classify_replay(r#"{"jsonrpc":"2.0","method":"initialized"}"#),
        Replay::Initialized
    ));
    for other in [r#"{"method":"textDocument/didOpen"}"#, "not json"] {
        assert!(matches!(classify_replay(other), Replay::Other), "{other}");
    }
}
