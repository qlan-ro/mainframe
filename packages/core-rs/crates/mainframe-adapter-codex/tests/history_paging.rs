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
use mainframe_adapter_api::{AdapterSession, HistoryPage, WindowRequest};
use mainframe_adapter_codex::CodexSession;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_runtime::ResolvedPath;
use mainframe_types::adapter::ForkSource;
use mainframe_types::chat::ChatMessage;
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

async fn window(
    session: &CodexSession,
    enough: impl Fn(&[ChatMessage]) -> bool + Send + Sync,
) -> Option<HistoryPage> {
    session
        .load_history_window(WindowRequest {
            turns: 2,
            enough: &enough,
        })
        .await
        .unwrap()
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

    let page = window(&session, |_| true).await.expect("the CLI pages");

    assert_eq!(message_texts(&page.messages), ["TWO", "THREE"]);
    assert!(page.older);
    let requests = captured_requests(&capture);
    assert!(requests_with_method(&requests, "thread/read").is_empty());
    let lists = requests_with_method(&requests, "thread/turns/list");
    assert_eq!(lists.len(), 1, "one page, one client");
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
async fn older_pages_are_fetched_by_cursor_through_one_client() {
    let dir = tempdir().unwrap();
    let capture = dir.path().join("capture.jsonl");
    let fake = write_fake_app_server(dir.path(), &capture, PAGED_SERVER);
    let session = session(Some("thread-1"), None, &fake);

    let page = window(&session, |messages| messages.len() >= 3)
        .await
        .expect("the CLI pages");

    assert_eq!(message_texts(&page.messages), ["ONE", "TWO", "THREE"]);
    assert!(!page.older, "a null cursor is the start of the thread");
    let requests = captured_requests(&capture);
    let lists = requests_with_method(&requests, "thread/turns/list");
    assert_eq!(lists.len(), 2);
    assert_eq!(lists[1]["params"]["cursor"], "older-1");
    assert_eq!(
        requests_with_method(&requests, "initialize").len(),
        1,
        "every page of a window shares one temporary app-server"
    );
}

#[tokio::test]
async fn a_cli_without_the_method_falls_back_and_is_not_asked_again() {
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

    assert!(window(&session, |_| true).await.is_none());
    assert!(window(&session, |_| true).await.is_none());
    let history = session.load_history().await.unwrap();

    assert_eq!(message_texts(&history), ["WHOLE"]);
    let requests = captured_requests(&capture);
    assert_eq!(
        requests_with_method(&requests, "thread/turns/list").len(),
        1,
        "an executable that lacks the method is not probed on every open"
    );
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

    assert!(window(&session, |_| true).await.is_none());
    assert!(captured_requests(&capture).is_empty());
}

const COLLAB_SERVER: &str = r#"    thread/turns/list)
      if printf '%s' "$line" | grep -q '"cursor":"c2"'; then
        printf '{"id":%s,"result":{"data":[{"id":"turn-2","status":"completed","items":[{"type":"agentMessage","id":"mid","text":"MIDDLE"}]}],"nextCursor":"c1"}}\n' "$id"
      elif printf '%s' "$line" | grep -q '"cursor":"c1"'; then
        printf '{"id":%s,"result":{"data":[{"id":"turn-1","status":"completed","items":[{"type":"subAgentActivity","id":"task","kind":"started","agentThreadId":"child-1"}]}],"nextCursor":null}}\n' "$id"
      else
        printf '{"id":%s,"result":{"data":[{"id":"turn-3","status":"completed","items":[{"type":"collabAgentToolCall","id":"wait-1","tool":"wait","status":"completed","senderThreadId":"thread-1","receiverThreadIds":["child-1"],"agentsStates":{"child-1":{"status":"completed","message":"CHILD DONE"}}}]}],"nextCursor":"c2"}}\n' "$id"
      fi
      ;;
    thread/read)
      if printf '%s' "$line" | grep -q '"threadId":"child-1"'; then
        printf '{"id":%s,"result":{"thread":{"id":"child-1","turns":[{"id":"c-turn","status":"completed","items":[{"type":"agentMessage","id":"cm1","text":"CHILD STEP"}]}]}}}\n' "$id"
      else
        printf '{"id":%s,"result":{"thread":{"id":"thread-1","turns":[{"id":"turn-1","status":"completed","items":[{"type":"subAgentActivity","id":"task","kind":"started","agentThreadId":"child-1"}]},{"id":"turn-2","status":"completed","items":[{"type":"agentMessage","id":"mid","text":"MIDDLE"}]},{"id":"turn-3","status":"completed","items":[{"type":"collabAgentToolCall","id":"wait-1","tool":"wait","status":"completed","senderThreadId":"thread-1","receiverThreadIds":["child-1"],"agentsStates":{"child-1":{"status":"completed","message":"CHILD DONE"}}}]}]}}}\n' "$id"
      fi
      ;;"#;

/// Everything a client renders from a message, without the load time.
fn shape(messages: &[ChatMessage]) -> Vec<serde_json::Value> {
    messages
        .iter()
        .map(|m| serde_json::json!([m.id, m.r#type, m.content]))
        .collect()
}

#[tokio::test]
async fn a_sub_agent_spanning_pages_is_one_card_equal_to_the_whole_read() {
    let dir = tempdir().unwrap();
    let capture = dir.path().join("capture.jsonl");
    let fake = write_fake_app_server(dir.path(), &capture, COLLAB_SERVER);
    let session = session(Some("thread-1"), None, &fake);

    // The first page names the child without opening it, so paging goes on
    // to the turn that does, even though the caller was already satisfied.
    let page = window(&session, |_| true).await.expect("the CLI pages");
    let whole = session.load_history().await.unwrap();

    assert!(!page.older);
    let rendered = serde_json::to_string(&page.messages).unwrap();
    assert!(rendered.contains("CHILD STEP"), "{rendered}");
    assert_eq!(shape(&page.messages), shape(&whole));
    let requests = captured_requests(&capture);
    assert_eq!(
        requests_with_method(&requests, "thread/turns/list").len(),
        3
    );
}

#[tokio::test]
async fn a_sub_agent_whose_opening_turn_is_out_of_reach_reads_the_whole_thread() {
    let dir = tempdir().unwrap();
    let capture = dir.path().join("capture.jsonl");
    let fake = write_fake_app_server(
        dir.path(),
        &capture,
        r#"    thread/turns/list)
      printf '{"id":%s,"result":{"data":[{"id":"turn-3","status":"completed","items":[{"type":"collabAgentToolCall","id":"wait-1","tool":"wait","status":"completed","receiverThreadIds":["child-1"]}]}],"nextCursor":"more"}}\n' "$id"
      ;;"#,
    );
    let session = session(Some("thread-1"), None, &fake);

    assert!(window(&session, |_| true).await.is_none());
}
