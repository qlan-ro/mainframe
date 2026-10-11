use super::*;
use crate::lsp_manager::{ClientRef, CommandResolver, LspManager};
use crate::lsp_registry::{LspRegistry, ResolvedCommand};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use tokio::sync::mpsc;

// --- fixtures / fakes -------------------------------------------------------

struct FakeResolver;
impl CommandResolver for FakeResolver {
    fn resolve_command<'a>(
        &'a self,
        _language: &'a str,
        _project_path: &'a str,
    ) -> Pin<Box<dyn Future<Output = Option<ResolvedCommand>> + Send + 'a>> {
        Box::pin(async {
            Some(ResolvedCommand {
                command: "cat".to_string(),
                args: vec![],
            })
        })
    }
}

fn manager() -> Arc<LspManager> {
    Arc::new(LspManager::with_resolver(
        Arc::new(LspRegistry::new()),
        Arc::new(FakeResolver),
    ))
}

// --- handle_upgrade ---------------------------------------------------------

fn assert_reject(outcome: &UpgradeOutcome, expected: StatusKind) {
    match outcome {
        UpgradeOutcome::Reject(status) => assert_eq!(*status, expected),
        UpgradeOutcome::Proceed(_) => panic!("expected Reject({expected:?}), got Proceed"),
    }
}

#[tokio::test]
async fn rejects_deleted_scope_with_404() {
    let handler = LspConnectionHandler::new(manager());
    let outcome = handler
        .handle_upgrade("p1", "typescript", "/nonexistent-mainframe-lsp-scope")
        .await;
    assert_reject(&outcome, StatusKind::NotFound);
}

#[tokio::test]
async fn rejects_unsupported_language_with_404() {
    let root = tempfile::tempdir().unwrap();
    let handler = LspConnectionHandler::new(manager());
    let outcome = handler
        .handle_upgrade("p1", "rust", root.path().to_str().unwrap())
        .await;
    assert_reject(&outcome, StatusKind::NotFound);
}

#[tokio::test]
async fn proceeds_with_worktree_path_as_project_path() {
    let wt = tempfile::tempdir().unwrap();
    let wt_path = wt.path().to_str().unwrap().to_string();
    let m = manager();
    let handler = LspConnectionHandler::new(m.clone());
    let outcome = handler.handle_upgrade("p1", "typescript", &wt_path).await;
    match outcome {
        UpgradeOutcome::Proceed(handle) => assert_eq!(handle.project_path, wt_path),
        UpgradeOutcome::Reject(s) => panic!("expected Proceed, got Reject({s:?})"),
    }
    m.shutdown_all().await;
}

#[tokio::test]
async fn proceeds_with_project_root_when_no_chat_id() {
    let root = tempfile::tempdir().unwrap();
    let root_path = root.path().to_str().unwrap().to_string();
    let m = manager();
    let handler = LspConnectionHandler::new(m.clone());
    let outcome = handler
        .handle_upgrade("p1", "typescript", root.path().to_str().unwrap())
        .await;
    match outcome {
        UpgradeOutcome::Proceed(handle) => assert_eq!(handle.project_path, root_path),
        UpgradeOutcome::Reject(s) => panic!("expected Proceed, got Reject({s:?})"),
    }
    m.shutdown_all().await;
}

#[tokio::test]
async fn closes_stale_client_when_new_client_connects() {
    let tmp = tempfile::tempdir().unwrap();
    let m = manager();

    // Spawn a handle and attach a live (OPEN) client.
    let handle = m
        .get_or_spawn("p1", "typescript", tmp.path().to_str().unwrap())
        .await
        .unwrap();
    let open = Arc::new(AtomicBool::new(true));
    let (close_tx, mut close_rx) = mpsc::unbounded_channel::<(u16, String)>();
    handle.set_client(Some(ClientRef::new(open.clone(), close_tx)));

    let handler = LspConnectionHandler::new(m.clone());
    let _ = handler
        .handle_upgrade("p1", "typescript", tmp.path().to_str().unwrap())
        .await;

    let (code, reason) = close_rx.recv().await.unwrap();
    assert_eq!(code, 1001);
    assert_eq!(reason, "Replaced by new client");
    m.shutdown_all().await;
}

// --- reattach / init-capture helpers ---------------------------------------

#[test]
fn classify_reattach_first_replays_initialize() {
    let action = classify_reattach_first(r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#);
    assert_eq!(
        action,
        ReattachAction::ReplayInitialize {
            id: serde_json::json!(1)
        }
    );
}

#[test]
fn classify_reattach_first_skips_initialized_notification() {
    let action = classify_reattach_first(r#"{"jsonrpc":"2.0","method":"initialized"}"#);
    assert_eq!(action, ReattachAction::SkipInitialized);
}

#[test]
fn classify_reattach_first_forwards_other_and_unparseable() {
    assert_eq!(
        classify_reattach_first(r#"{"jsonrpc":"2.0","id":2,"method":"textDocument/hover"}"#),
        ReattachAction::Forward
    );
    assert_eq!(classify_reattach_first("not json"), ReattachAction::Forward);
    // initialize notification (no id) is forwarded, not replayed.
    assert_eq!(
        classify_reattach_first(r#"{"method":"initialize"}"#),
        ReattachAction::Forward
    );
}

#[test]
fn capture_initialize_result_extracts_result_with_capabilities() {
    let msg = r#"{"jsonrpc":"2.0","id":1,"result":{"capabilities":{"hoverProvider":true}}}"#;
    let result = capture_initialize_result(msg).unwrap();
    assert!(result.get("capabilities").is_some());
}

#[test]
fn capture_initialize_result_ignores_non_capability_messages() {
    assert!(capture_initialize_result(r#"{"result":{"foo":1}}"#).is_none());
    assert!(capture_initialize_result(r#"{"id":1,"method":"x"}"#).is_none());
    assert!(capture_initialize_result("nope").is_none());
}

#[test]
fn cached_initialize_reply_wraps_result_under_id() {
    let reply = cached_initialize_reply(
        &serde_json::json!(5),
        &serde_json::json!({"capabilities":{}}),
    );
    let parsed: serde_json::Value = serde_json::from_str(&reply).unwrap();
    assert_eq!(parsed["jsonrpc"], "2.0");
    assert_eq!(parsed["id"], 5);
    assert!(parsed["result"]["capabilities"].is_object());
}
