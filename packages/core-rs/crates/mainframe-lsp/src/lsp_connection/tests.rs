//! Translated from `packages/core/src/__tests__/lsp/lsp-connection.test.ts`.

use super::*;
use crate::lsp_manager::{ClientRef, CommandResolver, LspManager};
use crate::lsp_registry::{LspRegistry, ResolvedCommand};
use mainframe_types::chat::{Chat, ChatStatus, Project};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use tokio::sync::mpsc;

// --- parse_lsp_upgrade_path -------------------------------------------------

#[test]
fn parses_valid_lsp_path() {
    let r = parse_lsp_upgrade_path("/lsp/abc-123/typescript").unwrap();
    assert_eq!(r.project_id, "abc-123");
    assert_eq!(r.language, "typescript");
    assert_eq!(r.chat_id, None);
}

#[test]
fn parses_path_with_query_params_but_no_chat_id() {
    let r = parse_lsp_upgrade_path("/lsp/abc-123/python?token=xyz").unwrap();
    assert_eq!(r.project_id, "abc-123");
    assert_eq!(r.language, "python");
    assert_eq!(r.chat_id, None);
}

#[test]
fn parses_chat_id_from_query_string() {
    let r = parse_lsp_upgrade_path("/lsp/abc-123/typescript?chatId=chat-99").unwrap();
    assert_eq!(r.chat_id.as_deref(), Some("chat-99"));
}

#[test]
fn parses_chat_id_alongside_other_query_params() {
    let r = parse_lsp_upgrade_path("/lsp/proj-1/python?token=abc&chatId=chat-42").unwrap();
    assert_eq!(r.project_id, "proj-1");
    assert_eq!(r.language, "python");
    assert_eq!(r.chat_id.as_deref(), Some("chat-42"));
}

#[test]
fn returns_none_for_non_lsp_paths() {
    assert!(parse_lsp_upgrade_path("/").is_none());
    assert!(parse_lsp_upgrade_path("/api/chats").is_none());
    assert!(parse_lsp_upgrade_path("/lsp").is_none());
    assert!(parse_lsp_upgrade_path("/lsp/abc").is_none());
}

// --- fixtures / fakes -------------------------------------------------------

fn make_project(id: &str, path: &str) -> Project {
    Project {
        id: id.to_string(),
        name: "test".to_string(),
        path: path.to_string(),
        created_at: "2020-01-01T00:00:00.000Z".to_string(),
        last_opened_at: "2020-01-01T00:00:00.000Z".to_string(),
        parent_project_id: None,
    }
}

fn make_chat(
    project_id: &str,
    worktree_path: Option<&str>,
    worktree_missing: Option<bool>,
) -> Chat {
    Chat {
        id: "chat".to_string(),
        adapter_id: "claude".to_string(),
        project_id: project_id.to_string(),
        title: None,
        claude_session_id: None,
        session_file_path: None,
        model: None,
        permission_mode: None,
        plan_mode: None,
        status: ChatStatus::Active,
        created_at: "2020-01-01T00:00:00.000Z".to_string(),
        updated_at: "2020-01-01T00:00:00.000Z".to_string(),
        total_cost: 0.0,
        total_tokens_input: 0,
        total_tokens_output: 0,
        last_context_tokens_input: 0,
        last_context_total_tokens: None,
        last_context_max_tokens: None,
        context_files: None,
        mentions: None,
        modified_files: None,
        worktree_path: worktree_path.map(|s| s.to_string()),
        branch_name: None,
        process_state: None,
        display_status: None,
        is_running: None,
        background_activity: None,
        worktree_missing,
        transcript_missing: None,
        todos: None,
        pinned: None,
        effort: None,
        fast: None,
        ultracode: None,
        adaptive_thinking: None,
        detected_prs: None,
        tags: None,
    }
}

struct FakeDb {
    project: Option<Project>,
}
impl ProjectStore for FakeDb {
    fn get_project(&self, _project_id: &str) -> Option<Project> {
        self.project.clone()
    }
}

struct FakeChats {
    chat: Option<Chat>,
}
impl ChatStore for FakeChats {
    fn get_chat(&self, _chat_id: &str) -> Option<Chat> {
        self.chat.clone()
    }
}

struct FakeResolver;
impl CommandResolver for FakeResolver {
    fn resolve_command<'a>(
        &'a self,
        _language: &'a str,
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

// --- get_effective_path -----------------------------------------------------

#[test]
fn effective_path_returns_project_root_without_chat() {
    let db = FakeDb {
        project: Some(make_project("p1", "/project/root")),
    };
    let path = get_effective_path(&db, None, "p1", None);
    assert_eq!(path.as_deref(), Some("/project/root"));
}

#[test]
fn effective_path_returns_worktree_for_live_worktree() {
    let db = FakeDb {
        project: Some(make_project("p1", "/project/root")),
    };
    let chats = FakeChats {
        chat: Some(make_chat("p1", Some("/wt/feat"), Some(false))),
    };
    let path = get_effective_path(&db, Some(&chats), "p1", Some("chat-1"));
    assert_eq!(path.as_deref(), Some("/wt/feat"));
}

#[test]
fn effective_path_none_for_missing_worktree() {
    let db = FakeDb {
        project: Some(make_project("p1", "/project/root")),
    };
    let chats = FakeChats {
        chat: Some(make_chat("p1", Some("/wt/feat"), Some(true))),
    };
    assert!(get_effective_path(&db, Some(&chats), "p1", Some("chat-1")).is_none());
}

#[test]
fn effective_path_rejects_cross_project_chat() {
    let db = FakeDb {
        project: Some(make_project("p1", "/project/root")),
    };
    let chats = FakeChats {
        chat: Some(make_chat("other", Some("/wt/feat"), Some(false))),
    };
    assert!(get_effective_path(&db, Some(&chats), "p1", Some("chat-1")).is_none());
}

#[test]
fn effective_path_unknown_project_none() {
    let db = FakeDb { project: None };
    assert!(get_effective_path(&db, None, "p1", None).is_none());
}

// --- handle_upgrade ---------------------------------------------------------

fn assert_reject(outcome: &UpgradeOutcome, needle: &str) {
    match outcome {
        UpgradeOutcome::Reject(status) => assert!(status.contains(needle), "status was {status}"),
        UpgradeOutcome::Proceed(_) => panic!("expected Reject({needle}), got Proceed"),
    }
}

#[tokio::test]
async fn rejects_upgrade_for_unknown_project_with_404() {
    let handler: LspConnectionHandler<FakeDb, FakeChats> =
        LspConnectionHandler::new(manager(), Arc::new(FakeDb { project: None }));
    let outcome = handler
        .handle_upgrade("unknown-id", "typescript", None)
        .await;
    assert_reject(&outcome, "404");
}

#[tokio::test]
async fn rejects_upgrade_for_unsupported_language_with_404() {
    let tmp = tempfile::tempdir().unwrap();
    let db = Arc::new(FakeDb {
        project: Some(make_project("p1", tmp.path().to_str().unwrap())),
    });
    let handler: LspConnectionHandler<FakeDb, FakeChats> = LspConnectionHandler::new(manager(), db);
    let outcome = handler.handle_upgrade("p1", "rust", None).await;
    assert_reject(&outcome, "404");
}

#[tokio::test]
async fn rejects_upgrade_with_409_when_worktree_missing() {
    let db = Arc::new(FakeDb {
        project: Some(make_project("p1", "/project/root")),
    });
    let chats = Arc::new(FakeChats {
        chat: Some(make_chat("p1", Some("/wt/feat"), Some(true))),
    });
    let handler = LspConnectionHandler::with_chats(manager(), db, chats);
    let outcome = handler
        .handle_upgrade("p1", "typescript", Some("chat-missing-wt"))
        .await;
    assert_reject(&outcome, "409");
}

#[tokio::test]
async fn proceeds_with_worktree_path_as_project_path() {
    let root = tempfile::tempdir().unwrap();
    let wt = tempfile::tempdir().unwrap();
    let wt_path = wt.path().to_str().unwrap().to_string();
    let db = Arc::new(FakeDb {
        project: Some(make_project("p1", root.path().to_str().unwrap())),
    });
    let chats = Arc::new(FakeChats {
        chat: Some(make_chat("p1", Some(&wt_path), Some(false))),
    });
    let m = manager();
    let handler = LspConnectionHandler::with_chats(m.clone(), db, chats);
    let outcome = handler
        .handle_upgrade("p1", "typescript", Some("chat-wt-1"))
        .await;
    match outcome {
        UpgradeOutcome::Proceed(handle) => assert_eq!(handle.project_path, wt_path),
        UpgradeOutcome::Reject(s) => panic!("expected Proceed, got Reject({s})"),
    }
    m.shutdown_all().await;
}

#[tokio::test]
async fn proceeds_with_project_root_when_no_chat_id() {
    let root = tempfile::tempdir().unwrap();
    let root_path = root.path().to_str().unwrap().to_string();
    let db = Arc::new(FakeDb {
        project: Some(make_project("p1", &root_path)),
    });
    let m = manager();
    let handler: LspConnectionHandler<FakeDb, FakeChats> = LspConnectionHandler::new(m.clone(), db);
    let outcome = handler.handle_upgrade("p1", "typescript", None).await;
    match outcome {
        UpgradeOutcome::Proceed(handle) => assert_eq!(handle.project_path, root_path),
        UpgradeOutcome::Reject(s) => panic!("expected Proceed, got Reject({s})"),
    }
    m.shutdown_all().await;
}

#[tokio::test]
async fn closes_stale_client_when_new_client_connects() {
    let tmp = tempfile::tempdir().unwrap();
    let db = Arc::new(FakeDb {
        project: Some(make_project("p1", tmp.path().to_str().unwrap())),
    });
    let m = manager();

    // Spawn a handle and attach a live (OPEN) client.
    let handle = m
        .get_or_spawn("p1", "typescript", tmp.path().to_str().unwrap())
        .await
        .unwrap();
    let open = Arc::new(AtomicBool::new(true));
    let (close_tx, mut close_rx) = mpsc::unbounded_channel::<(u16, String)>();
    handle.set_client(Some(ClientRef::new(open.clone(), close_tx)));

    let handler: LspConnectionHandler<FakeDb, FakeChats> = LspConnectionHandler::new(m.clone(), db);
    let _ = handler.handle_upgrade("p1", "typescript", None).await;

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
