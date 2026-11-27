//! Paged history reads over `thread/turns/list` (codex-cli 0.122 and newer).
//!
//! `thread/read` with `includeTurns` hydrates the whole thread, which the CLI
//! marks deprecated for paginated threads and which costs tens of megabytes on
//! a long one. `thread/turns/list` returns a page of turns instead: newest
//! first by default, `nextCursor` names the page before it, and `itemsView:
//! "full"` returns every item `thread/read` would (the default, `summary`,
//! carries only a display summary, so it is never used here).

use std::sync::Arc;

use mainframe_adapter_api::{AdapterError, HistoryPage};
use serde::Deserialize;
use serde_json::json;

use crate::history_load::build_history;
use crate::jsonrpc::JsonRpcClient;
use crate::session::de;
use crate::types::ThreadReadTurn;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TurnsPage {
    data: Vec<ThreadReadTurn>,
    #[serde(default)]
    next_cursor: Option<String>,
}

/// One page of turns, oldest first, converted to messages. `Ok(None)` when the
/// CLI cannot answer `thread/turns/list` for the first page (an older CLI
/// without the method, or a thread it will not page): the caller falls back to
/// the whole-thread read. A failure on a later page is a real error, because
/// the caller already holds the newer pages.
pub(crate) async fn load_page(
    temp: &Arc<JsonRpcClient>,
    thread_id: &str,
    cursor: Option<&str>,
    turns: usize,
) -> Result<Option<HistoryPage>, AdapterError> {
    let mut params = json!({
        "threadId": thread_id,
        "limit": turns,
        "itemsView": "full",
        "sortDirection": "desc",
    });
    if let Some(cursor) = cursor {
        params["cursor"] = json!(cursor);
    }
    let value = match temp.request("thread/turns/list", Some(params)).await {
        Ok(value) => value,
        Err(error) if cursor.is_none() => {
            tracing::debug!(
                error = %error.0,
                thread_id,
                "thread/turns/list unavailable, reading the whole thread"
            );
            return Ok(None);
        }
        Err(error) => return Err(error.into()),
    };
    let page: TurnsPage = de(value)?;
    let mut turns = page.data;
    // The CLI answers newest first; the transcript reads oldest first.
    turns.reverse();
    let loaded = build_history(temp, thread_id, &turns).await?;
    Ok(Some(HistoryPage {
        messages: loaded.messages,
        older: page.next_cursor.filter(|cursor| !cursor.is_empty()),
    }))
}
