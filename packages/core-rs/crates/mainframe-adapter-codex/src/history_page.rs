//! Paged history reads over `thread/turns/list` (codex-cli 0.122 and newer).
//!
//! `thread/read` with `includeTurns` hydrates the whole thread, which the CLI
//! marks deprecated for paginated threads and which costs tens of megabytes on
//! a long one. `thread/turns/list` returns a page of turns instead: newest
//! first by default, `nextCursor` names the page before it, and `itemsView:
//! "full"` returns every item `thread/read` would (the default, `summary`,
//! carries only a display summary, so it is never used here).
//!
//! The turns of every page are gathered first and converted together, so a
//! sub-agent card opened in one turn and awaited in the next is one card, as
//! in a whole read.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{AdapterError, HistoryPage, WindowRequest};
use serde::Deserialize;
use serde_json::json;

use crate::collab_protocol::{
    CollabTool, SubAgentKind, classify_collab_tool, classify_sub_agent_kind,
};
use crate::history_load::build_history;
use crate::item_types::ThreadItem;
use crate::jsonrpc::JsonRpcClient;
use crate::session::de;
use crate::types::ThreadReadTurn;

/// Pages read at most before the window is answered with what it has.
const MAX_PAGES: usize = 8;

/// Executables that answered `thread/turns/list` as an unknown method, so no
/// later open spawns a process just to learn that again.
static LACKING: Mutex<Option<HashSet<String>>> = Mutex::new(None);

pub(crate) fn known_to_lack(executable: &str) -> bool {
    LACKING
        .lock()
        .ok()
        .is_some_and(|set| set.as_ref().is_some_and(|set| set.contains(executable)))
}

fn remember_lacking(executable: &str) {
    if let Ok(mut set) = LACKING.lock() {
        set.get_or_insert_default().insert(executable.to_owned());
    }
}

/// An old CLI rejects the unknown method by name; any other failure (a thread
/// it will not page, a transient error) must not mark the whole CLI.
fn is_unknown_method(message: &str) -> bool {
    message.contains("thread/turns/list") || message.to_lowercase().contains("method not found")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TurnsPage {
    data: Vec<ThreadReadTurn>,
    #[serde(default)]
    next_cursor: Option<String>,
}

/// The newest turns, converted oldest first, from as many pages as `req`
/// needs. `Ok(None)` when the CLI cannot answer `thread/turns/list` for the
/// first page, or when the window names a sub-agent whose opening turn it
/// could not reach: the caller reads the whole thread instead.
pub(crate) async fn load_window(
    temp: &Arc<JsonRpcClient>,
    executable: &str,
    thread_id: &str,
    req: WindowRequest<'_>,
) -> Result<Option<HistoryPage>, AdapterError> {
    let mut turns: Vec<ThreadReadTurn> = Vec::new();
    let mut cursor: Option<String> = None;
    let mut older = true;
    let mut converted = None;
    for page_index in 0..MAX_PAGES {
        let mut params = json!({
            "threadId": thread_id,
            "limit": req.turns,
            "itemsView": "full",
            "sortDirection": "desc",
        });
        if let Some(cursor) = &cursor {
            params["cursor"] = json!(cursor);
        }
        let value = match temp.request("thread/turns/list", Some(params)).await {
            Ok(value) => value,
            Err(error) if page_index == 0 => {
                if is_unknown_method(&error.0) {
                    remember_lacking(executable);
                }
                tracing::debug!(
                    error = %error.0,
                    thread_id,
                    "thread/turns/list unavailable, reading the whole thread"
                );
                return Ok(None);
            }
            Err(error) => {
                tracing::debug!(error = %error.0, thread_id, "older history page failed");
                break;
            }
        };
        let page: TurnsPage = de(value)?;
        cursor = page.next_cursor.filter(|cursor| !cursor.is_empty());
        older = cursor.is_some();
        // The CLI answers newest first; the transcript reads oldest first.
        turns.splice(0..0, page.data.into_iter().rev());
        if older && names_unopened_child(&turns) {
            converted = None;
            continue;
        }
        let loaded = build_history(temp, thread_id, &turns).await?;
        let done = !older || (req.enough)(&loaded.messages);
        converted = Some(loaded.messages);
        if done {
            break;
        }
    }
    Ok(converted.map(|messages| HistoryPage { messages, older }))
}

/// Whether the turns name a sub-agent they never open. A card opens on a
/// `started` ping (or, in the legacy route, on a `wait`); one named without a
/// ping before it may have been opened in an older turn, and converting
/// without that turn would open a second card for it.
fn names_unopened_child(turns: &[ThreadReadTurn]) -> bool {
    let mut opened: HashSet<&str> = HashSet::new();
    for item in turns.iter().flat_map(|turn| &turn.items) {
        match item {
            ThreadItem::SubAgentActivity(a) => {
                if classify_sub_agent_kind(&a.kind) == SubAgentKind::Started {
                    opened.insert(&a.agent_thread_id);
                } else if !opened.contains(a.agent_thread_id.as_str()) {
                    return true;
                }
            }
            ThreadItem::CollabAgentToolCall(c)
                if classify_collab_tool(&c.tool) == CollabTool::Wait =>
            {
                for child in c.receiver_thread_ids.iter().flatten() {
                    if !opened.contains(child.as_str()) {
                        return true;
                    }
                }
            }
            _ => {}
        }
    }
    false
}
