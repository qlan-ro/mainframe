use super::*;
use mainframe_types::acp::extensions::HistoryState;
use mainframe_types::acp::jsonrpc::{JsonRpcOutcome, RequestId};
use serde_json::json;

#[derive(Clone, Serialize, Deserialize)]
pub struct PreparedHistoryTail {
    containers: Vec<Vec<EncodedItem>>,
    preview_ids: HashSet<String>,
    history: HistoryState,
}

impl PreparedHistoryTail {
    pub fn capture(response: &JsonRpcResponse, replay: &ResumeReplay) -> Option<Self> {
        if replay.pending_gate.is_some() || replay.pending_permission_request.is_some() {
            return None;
        }
        let JsonRpcOutcome::Result { result } = &response.outcome else {
            return None;
        };
        let history = serde_json::from_value(
            result
                .get("_meta")?
                .get(MAINFRAME_META_NAMESPACE)?
                .get("history")?
                .clone(),
        )
        .ok()?;
        let containers = replay
            .containers
            .iter()
            .map(|items| {
                items
                    .iter()
                    .map(|item| {
                        if replay.preview_ids.contains(item.id()) {
                            replay_previews::preview_item(item)
                        } else {
                            item.clone()
                        }
                    })
                    .collect()
            })
            .collect();
        Some(Self {
            containers,
            preview_ids: replay.preview_ids.clone(),
            history,
        })
    }

    pub fn replay(
        self,
        id: Option<RequestId>,
        cursor: Option<&WireRevisionCursor>,
    ) -> (JsonRpcResponse, ResumeReplay) {
        let items: Vec<_> = self.containers.iter().flatten().cloned().collect();
        let mut state = SessionState::new();
        state.set_previews(self.preview_ids.clone());
        let mut updates = state.diff(&items);
        let item_count = updates.len();
        updates.push(super::turn_state_update(None));
        let mut meta = super::resume_meta(item_count, true, cursor);
        meta[MAINFRAME_META_NAMESPACE]["history"] = json!(self.history);
        let response = rpc::success_response(id, json!({ "_meta": meta }));
        (
            response,
            ResumeReplay {
                updates,
                items,
                containers: self.containers,
                preview_ids: self.preview_ids,
                pending_gate: None,
                pending_permission_request: None,
            },
        )
    }
}
