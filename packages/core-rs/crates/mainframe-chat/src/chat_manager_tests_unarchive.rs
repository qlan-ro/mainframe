//! `ChatManager::unarchive_native_session` tests.

use super::*;
use mainframe_types::http_status::{HttpStatus, StatusKind};

fn codex_chat(vendor_session_id: Option<&str>, worktree: Option<&str>) -> Chat {
    let mut c = test_chat("c1");
    c.adapter_id = "codex".to_string();
    c.vendor_session_id = vendor_session_id.map(str::to_string);
    c.worktree_path = worktree.map(str::to_string);
    c
}

#[tokio::test]
async fn asks_the_chats_adapter_to_unarchive_its_session_in_the_chats_worktree() {
    let deps = FakeDeps::with_chats(vec![codex_chat(Some("thread-1"), Some("/tmp/wt"))]);
    let mgr = ChatManager::new(deps.clone());

    mgr.unarchive_native_session("c1").await.unwrap();

    assert_eq!(
        *deps.adapters.unarchive_requests.lock().unwrap(),
        vec![(
            "codex".to_string(),
            "thread-1".to_string(),
            "/tmp/wt".to_string()
        )]
    );
}

#[tokio::test]
async fn a_chat_without_a_provider_session_is_refused_409() {
    let deps = FakeDeps::with_chats(vec![codex_chat(None, None)]);
    let mgr = ChatManager::new(deps.clone());

    let err = mgr.unarchive_native_session("c1").await.unwrap_err();

    assert!(matches!(err, UnarchiveNativeSessionError::NoNativeSession));
    assert_eq!(err.status_kind(), StatusKind::Conflict);
    assert!(deps.adapters.unarchive_requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_unknown_chat_is_not_found() {
    let mgr = ChatManager::new(FakeDeps::arc());
    let err = mgr.unarchive_native_session("nope").await.unwrap_err();
    assert_eq!(err.status_kind(), StatusKind::NotFound);
}
