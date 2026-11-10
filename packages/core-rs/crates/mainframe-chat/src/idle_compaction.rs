use crate::{chat_manager::ChatShared, lifecycle_manager::ChatLifecycleManager};
use mainframe_adapter_api::{AdapterSession, idle_compaction::*};
use mainframe_types::{
    chat::{ChatMessage, ChatStatus, MessageContent, MessageContentNode, ProcessState},
    sync::LockExt as _,
};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};

#[derive(Default)]
pub(crate) struct MaintenanceState {
    pub requests: Mutex<HashMap<String, NativeCompactionRequest>>,
    pub reserved: Mutex<HashSet<String>>,
}

impl MaintenanceState {
    pub fn active(&self, chat_id: &str) -> bool {
        self.reserved.lock_recover().contains(chat_id)
    }
    pub fn matches(&self, chat_id: &str, metadata: &CompactionMetadata) -> bool {
        self.requests.lock_recover().get(chat_id).is_some_and(|r| {
            r.id == metadata.request_id && r.session_generation == metadata.session_generation
        })
    }
    pub fn finish(&self, chat_id: &str, request: &NativeCompactionRequest) {
        let mut requests = self.requests.lock_recover();
        if requests.get(chat_id) == Some(request) {
            requests.remove(chat_id);
        }
    }
}

#[derive(Clone)]
pub(crate) struct IdleCompactor {
    pub shared: Arc<ChatShared>,
    pub lifecycle: Arc<ChatLifecycleManager>,
    pub timing_override: Option<CompactionTiming>,
    pub now: Arc<dyn Fn() -> i64 + Send + Sync>,
}

impl IdleCompactor {
    pub async fn evaluate(&self, chat_id: &str) {
        let Some(_claim) = self.lifecycle.try_claim_maintenance(chat_id) else {
            return;
        };
        if !self.enabled().await {
            return;
        }
        let Some((session, run)) = self.eligible(chat_id, (self.now)()) else {
            return;
        };
        let Some(request) = self.claim_run(chat_id, &session, &run) else {
            return;
        };
        let boundaries = self.boundary_count(chat_id);
        self.shared
            .maintenance
            .requests
            .lock_recover()
            .insert(chat_id.to_owned(), request.clone());
        if !self.enabled().await || !self.dispatch_eligible(chat_id, &request) {
            return;
        }
        match session.native_compact(request.clone()).await {
            Ok(metadata) => {
                self.correlate_legacy(chat_id, &session, metadata, boundaries)
                    .await
            }
            Err(_) => tracing::warn!(chat_id, "idle compaction request failed"),
        }
        self.shared.maintenance.finish(chat_id, &request);
    }

    async fn enabled(&self) -> bool {
        mainframe_services::settings::read_setting(
            self.shared.deps.settings(),
            "general",
            "idleCompaction.enabled",
        )
        .await
        .as_deref()
            == Some("true")
    }

    fn dispatch_eligible(&self, chat_id: &str, request: &NativeCompactionRequest) -> bool {
        let Some((session, run)) =
            self.eligible_for_claim(chat_id, (self.now)(), Some(&request.id))
        else {
            return false;
        };
        let Some(cell) = self.shared.active(chat_id) else {
            return false;
        };
        let active = cell.lock_recover();
        session.id() == request.session_generation
            && active
                .session
                .as_ref()
                .is_some_and(|s| s.id() == request.session_generation)
            && self.session_due(&session, &active.chat, (self.now)(), &run)
    }

    fn claim_run(
        &self,
        chat_id: &str,
        session: &Arc<dyn AdapterSession>,
        run: &mainframe_db::idle_compaction::RealRun,
    ) -> Option<NativeCompactionRequest> {
        let request = NativeCompactionRequest {
            id: format!("idle-compact:{chat_id}:{}", run.generation),
            session_generation: session.id().to_owned(),
            origin: CompactionOrigin::Idle,
            command_uuid: command_uuid(),
        };
        match self
            .shared
            .deps
            .idle_run_claim(chat_id, &run.generation, &request)
        {
            Ok(true) => {}
            Ok(false) => return None,
            Err(_) => {
                tracing::warn!(chat_id, "idle compaction claim persistence failed");
                return None;
            }
        }
        Some(request)
    }
}

fn safe_tail(history: &[ChatMessage]) -> bool {
    let Some(last) = history.iter().rev().find(|m| !m.content.is_empty()) else {
        return false;
    };
    if last.content.iter().any(|c| {
        matches!(
            c,
            MessageContent::Node(MessageContentNode::Compaction { .. })
        )
    }) {
        return false;
    }
    let mut tools = HashSet::new();
    for message in history {
        for content in &message.content {
            match content {
                MessageContent::Node(MessageContentNode::ToolUse { id, .. }) => {
                    tools.insert(id.as_str());
                }
                MessageContent::Node(MessageContentNode::ToolResult { tool_use_id, .. }) => {
                    tools.remove(tool_use_id.as_str());
                }
                _ => {}
            }
        }
    }
    tools.is_empty()
}

fn command_uuid() -> String {
    let hex: Vec<char> = "0123456789abcdef".chars().collect();
    let value = nanoid::nanoid!(32, &hex);
    format!(
        "{}-{}-4{}-8{}-{}",
        &value[..8],
        &value[8..12],
        &value[13..16],
        &value[17..20],
        &value[20..]
    )
}

mod eligibility;

mod legacy;
