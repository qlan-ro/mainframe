//! Paged Codex history over `thread/turns/list`, driven against a fake
//! `codex app-server` that records every request.
#![cfg(unix)]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "Test assertions and scenarios"
)]

mod fork_support;

use std::sync::Arc;

use fork_support::{
    captured_requests, message_texts, options, requests_with_method, write_fake_app_server,
};
use mainframe_adapter_api::AdapterSession;
use mainframe_adapter_codex::CodexSession;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_runtime::ResolvedPath;
use mainframe_types::adapter::ForkSource;
use tempfile::tempdir;

fn session(
    chat_id: Option<&str>,
    fork: Option<ForkSource>,
    fake: &std::path::Path,
) -> CodexSession {
    let session = CodexSession::new(
        options(chat_id, fork),
        None,
        ResolvedPath::from_value("/usr/bin:/bin"),
        Arc::new(BackgroundTaskTracker::new()),
    );
    session.set_history_executable(fake.to_str().unwrap());
    session
}

const PAGED_SERVER: &str = r#"    thread/turns/list)
      if printf '%s' "$line" | grep -q '"cursor":"older-1"'; then
        printf '{"id":%s,"result":{"data":[{"id":"turn-1","status":"completed","items":[{"type":"agentMessage","id":"m1","text":"ONE"}]}],"nextCursor":null}}\n' "$id"
      else
        printf '{"id":%s,"result":{"data":[{"id":"turn-3","status":"completed","items":[{"type":"agentMessage","id":"m3","text":"THREE"}]},{"id":"turn-2","status":"completed","items":[{"type":"agentMessage","id":"m2","text":"TWO"}]}],"nextCursor":"older-1","backwardsCursor":"newer-1"}}\n' "$id"
      fi
      ;;
    thread/read)
      printf '{"id":%s,"error":{"code":-32600,"message":"a paged read must never hydrate the thread"}}\n' "$id"
      ;;"#;

#[tokio::test]
async fn the_first_window_comes_from_turns_list_alone() {
    let dir = tempdir().unwrap();
    let capture = dir.path().join("capture.jsonl");
    let fake = write_fake_app_server(dir.path(), &capture, PAGED_SERVER);
    let session = session(Some("thread-1"), None, &fake);

    let page = session
        .load_history_page(None, 2)
        .await
        .unwrap()
        .expect("the CLI pages");

    assert_eq!(message_texts(&page.messages), ["TWO", "THREE"]);
    assert_eq!(page.older.as_deref(), Some("older-1"));
    let requests = captured_requests(&capture);
    assert!(requests_with_method(&requests, "thread/read").is_empty());
    let lists = requests_with_method(&requests, "thread/turns/list");
    assert_eq!(lists.len(), 1);
    let params = &lists[0]["params"];
    assert_eq!(params["threadId"], "thread-1");
    assert_eq!(params["limit"], 2);
    assert_eq!(
        params["itemsView"], "full",
        "the default view only summarises turns"
    );
    assert_eq!(params["sortDirection"], "desc");
    assert!(params.get("cursor").is_none());
}

#[tokio::test]
async fn an_older_page_is_fetched_by_the_cursor_and_ends_the_history() {
    let dir = tempdir().unwrap();
    let capture = dir.path().join("capture.jsonl");
    let fake = write_fake_app_server(dir.path(), &capture, PAGED_SERVER);
    let session = session(Some("thread-1"), None, &fake);

    let page = session
        .load_history_page(Some("older-1".into()), 2)
        .await
        .unwrap()
        .expect("the CLI pages");

    assert_eq!(message_texts(&page.messages), ["ONE"]);
    assert_eq!(page.older, None, "no cursor means the start of the thread");
    let requests = captured_requests(&capture);
    let lists = requests_with_method(&requests, "thread/turns/list");
    assert_eq!(lists[0]["params"]["cursor"], "older-1");
}

#[tokio::test]
async fn a_cli_without_the_method_falls_back_to_the_whole_read() {
    let dir = tempdir().unwrap();
    let capture = dir.path().join("capture.jsonl");
    let fake = write_fake_app_server(
        dir.path(),
        &capture,
        r#"    thread/turns/list)
      printf '{"id":%s,"error":{"code":-32600,"message":"Invalid request: unknown variant `thread/turns/list`"}}\n' "$id"
      ;;
    thread/read)
      printf '{"id":%s,"result":{"thread":{"id":"thread-1","turns":[{"id":"turn-1","status":"completed","items":[{"type":"agentMessage","id":"m1","text":"WHOLE"}]}]}}}\n' "$id"
      ;;"#,
    );
    let session = session(Some("thread-1"), None, &fake);

    assert!(session.load_history_page(None, 2).await.unwrap().is_none());
    let history = session.load_history().await.unwrap();

    assert_eq!(message_texts(&history), ["WHOLE"]);
}

#[tokio::test]
async fn an_unsent_fork_is_not_paged() {
    let dir = tempdir().unwrap();
    let capture = dir.path().join("capture.jsonl");
    let fake = write_fake_app_server(dir.path(), &capture, PAGED_SERVER);
    let session = session(
        None,
        Some(ForkSource {
            source_session_id: "parent-1".into(),
            resume_path: None,
            last_turn_id: Some("turn-2".into()),
        }),
        &fake,
    );

    assert!(session.load_history_page(None, 2).await.unwrap().is_none());
    assert!(captured_requests(&capture).is_empty());
}

#[tokio::test]
async fn a_sub_agents_steps_appear_in_a_paged_window() {
    let dir = tempdir().unwrap();
    let capture = dir.path().join("capture.jsonl");
    let fake = write_fake_app_server(
        dir.path(),
        &capture,
        r#"    thread/turns/list)
      printf '{"id":%s,"result":{"data":[{"id":"turn-1","status":"completed","items":[{"type":"subAgentActivity","id":"task","kind":"started","agentThreadId":"child-1"}]}],"nextCursor":null}}\n' "$id"
      ;;
    thread/read)
      printf '{"id":%s,"result":{"thread":{"id":"child-1","turns":[{"id":"c-turn","status":"completed","items":[{"type":"agentMessage","id":"cm1","text":"CHILD STEP"}]}]}}}\n' "$id"
      ;;"#,
    );
    let session = session(Some("thread-1"), None, &fake);

    let page = session.load_history_page(None, 10).await.unwrap().unwrap();

    let rendered = serde_json::to_string(&page.messages).unwrap();
    assert!(rendered.contains("CHILD STEP"), "{rendered}");
    let requests = captured_requests(&capture);
    let reads = requests_with_method(&requests, "thread/read");
    assert_eq!(reads.len(), 1);
    assert_eq!(reads[0]["params"]["threadId"], "child-1");
}
