use mainframe_acp::SessionStream;
use mainframe_acp::history_page::PreparedPage;
use mainframe_acp::rpc;
use mainframe_types::acp::extensions::{HistoryPageResult, HistoryState};
use mainframe_types::acp::jsonrpc::RequestId;

use super::super::facade_conn::{FacadeConnection, SessionSlot};
use super::FacadeHub;
use super::fanout::drain_into;

impl FacadeHub {
    pub(crate) fn begin_history_page(
        &self,
        connection: &FacadeConnection,
        chat_id: &str,
        before: &str,
    ) -> Option<SessionStream> {
        let mut sessions = connection.locked_sessions();
        let Some(SessionSlot::Live(stream)) = sessions.get(chat_id) else {
            return None;
        };
        if stream.history_floor() != Some(before) {
            return None;
        }
        let previous = sessions.insert(
            chat_id.to_string(),
            SessionSlot::AwaitingSeed {
                pending: Vec::new(),
            },
        );
        match previous {
            Some(SessionSlot::Live(stream)) => Some(stream),
            _ => None,
        }
    }

    pub(crate) fn finish_history_page(
        &self,
        connection: &FacadeConnection,
        chat_id: &str,
        id: Option<RequestId>,
        mut stream: SessionStream,
        page: PreparedPage,
    ) {
        let mut sessions = connection.locked_sessions();
        let Some(buffered) = sessions.remove(chat_id) else {
            connection.send_json(&rpc::success_response(
                id,
                serde_json::json!(HistoryPageResult {
                    stale: Some(true),
                    ..HistoryPageResult::default()
                }),
            ));
            return;
        };
        if page.result.stale != Some(true) && !page.containers.is_empty() {
            stream.prepend_history(page.start, &page.containers, page.len, page.previews);
        }
        let catch_up = drain_into(&mut stream, buffered, connection, None);
        sessions.insert(chat_id.to_string(), SessionSlot::Live(stream));
        connection.send_json(&rpc::success_response(id, serde_json::json!(page.result)));
        for frame in catch_up {
            connection.send_throttled(chat_id, frame);
        }
    }

    pub(crate) fn stale_history_page(
        &self,
        connection: &FacadeConnection,
        chat_id: &str,
        id: Option<RequestId>,
    ) {
        let sessions = connection.locked_sessions();
        let floor_item_id = match sessions.get(chat_id) {
            Some(SessionSlot::Live(stream)) => stream.history_floor().map(str::to_string),
            _ => None,
        };
        connection.send_json(&rpc::success_response(
            id,
            serde_json::json!(HistoryPageResult {
                history: HistoryState {
                    has_more: floor_item_id.is_some(),
                    floor_item_id
                },
                stale: Some(true),
                ..HistoryPageResult::default()
            }),
        ));
    }
}
