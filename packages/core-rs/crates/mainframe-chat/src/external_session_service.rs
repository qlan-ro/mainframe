use mainframe_types::seam_error::SeamError;
use mainframe_types::sync::LockExt as _;
use std::cmp::Ordering;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::chat_manager::{ChatManagerDeps, ChatShared};
use mainframe_adapter_api::{AdapterError, BoxFuture};
use mainframe_services::settings::read_setting;
use mainframe_types::adapter::{ExternalSession, ExternalSessionPage};
use mainframe_types::chat::{Chat, NewChat};
use mainframe_types::chat_patch::ChatPatch;
use mainframe_types::events::DaemonEvent;
use tokio::task::JoinHandle;
use tracing::{debug, info, warn};

use crate::message_markers::visible_message_text;
use crate::title_generator::{derive_title_from_message, resolve_title_binary};

/// 5 minutes.
const SCAN_INTERVAL_MS: u64 = 5 * 60 * 1000;

/// Injected surface — the `db.*` / `adapters.*` reads the service makes.
///
/// External-session listing is not part of the `Adapter` trait, so it is
/// abstracted here as `external_session_adapter_ids` +
/// `list_external_sessions(...)`.
pub trait ExternalSessionDeps: ChatManagerDeps {
    fn create_imported_chat(&self, project_id: &str, adapter_id: &str) -> Result<Chat, SeamError> {
        self.chats_create(&NewChat {
            project_id: project_id.into(),
            adapter_id: adapter_id.into(),
            ..Default::default()
        })
    }
    /// Adapter ids that support `listExternalSessions`, in registry order.
    fn external_session_adapter_ids(&self) -> Vec<String>;
    fn list_external_sessions<'a>(
        &'a self,
        adapter_id: &'a str,
        project_path: &'a str,
        exclude_ids: &'a [String],
        offset: i64,
        limit: i64,
    ) -> BoxFuture<'a, Result<ExternalSessionPage, AdapterError>>;
}

pub struct ExternalSessionService<D: ExternalSessionDeps + 'static> {
    deps: Arc<D>,
    shared: Arc<ChatShared>,
    scan_intervals: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    last_counts: Arc<Mutex<HashMap<String, i64>>>,
}

impl<D: ExternalSessionDeps + 'static> ExternalSessionService<D> {
    pub(crate) fn new(deps: Arc<D>, shared: Arc<ChatShared>) -> Self {
        Self {
            deps,
            shared,
            scan_intervals: Arc::new(Mutex::new(HashMap::new())),
            last_counts: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Reconcile transcript presence for every non-archived chat of the project
    /// that has a CLI session id, so the sidebar degraded marker appears without
    /// the chat being opened. Runs on the same cadence as the auto-scan.
    #[cfg(test)]
    pub(crate) async fn sweep_transcript_presence(&self, project_id: &str) {
        self.shared.sweep_transcript_presence(project_id).await;
    }

    /// Page of importable external sessions merged and sorted across all adapters for a project.
    pub async fn scan_page(
        &self,
        project_id: &str,
        offset: i64,
        limit: i64,
    ) -> Result<ExternalSessionPage, SeamError> {
        scan_page_impl(self.deps.as_ref(), project_id, offset, limit).await
    }

    /// Import an external session, creating a Mainframe chat for it.
    pub async fn import_session(
        &self,
        project_id: &str,
        session_id: &str,
        adapter_id: &str,
        title: Option<&str>,
        created_at: Option<&str>,
        modified_at: Option<&str>,
    ) -> Result<Chat, SeamError> {
        if let Some(existing) = self
            .deps
            .find_by_external_session_id(session_id, project_id)?
        {
            return Ok(existing);
        }

        let mut chat = self.deps.create_imported_chat(project_id, adapter_id)?;
        let mut updates = ChatPatch {
            claude_session_id: Some(session_id.to_string()),
            ..Default::default()
        };

        // Drop the composer's markers (message_markers.rs) — an imported session's
        // first message carries them verbatim, and they address the agent or the
        // renderer, not the reader. This runs before strip_xml_tags because that
        // collapses newlines, which would fuse a marker block with the body into one
        // line the line-based strip then swallows whole. Both title paths consume it.
        let clean_title = title
            .map(visible_message_text)
            .map(|t| strip_xml_tags(&t))
            .filter(|s| !s.is_empty());
        if let Some(ct) = &clean_title {
            updates.title = Some(derive_title_from_message(ct));
        }

        if let Some(created) = created_at {
            updates.created_at = Some(created.to_string());
        }
        if let Some(modified) = modified_at {
            updates.updated_at = Some(modified.to_string());
        }
        self.deps.chats_update(&chat.id, &updates)?;
        // Object.assign(chat, updates)
        chat.claude_session_id = updates.claude_session_id.clone();
        if let Some(t) = &updates.title {
            chat.title = Some(t.clone());
        }
        if let Some(c) = &updates.created_at {
            chat.created_at = c.clone();
        }
        if let Some(u) = &updates.updated_at {
            chat.updated_at = u.clone();
        }

        info!(
            chat_id = chat.id,
            session_id, project_id, "external session imported"
        );
        self.deps.emit_event(DaemonEvent::ChatCreated {
            chat: chat.clone(),
            source: Some(mainframe_types::events::ChatCreatedSource::Import),
        });

        // Fire-and-forget LLM title generation to replace the truncated title
        if let Some(ct) = clean_title {
            let deps = self.deps.clone();
            let mut chat_for_title = chat.clone();
            let shared = self.shared.clone();
            let adapter_id = adapter_id.to_string();
            tokio::spawn(async move {
                generate_import_title(
                    deps.as_ref(),
                    &shared,
                    &mut chat_for_title,
                    &ct,
                    &adapter_id,
                )
                .await;
            });
        }

        Ok(chat)
    }

    /// Start auto-scanning for a project (on project open).
    pub fn start_auto_scan(&self, project_id: &str) {
        self.stop_auto_scan(project_id);

        {
            let deps = self.deps.clone();
            let shared = self.shared.clone();
            let last_counts = self.last_counts.clone();
            let pid = project_id.to_string();
            tokio::spawn(async move {
                emit_count(deps.as_ref(), &last_counts, &pid).await;
                shared.sweep_transcript_presence(&pid).await;
            });
        }

        let deps = self.deps.clone();
        let shared = self.shared.clone();
        let last_counts = self.last_counts.clone();
        let pid = project_id.to_string();
        let handle = tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_millis(SCAN_INTERVAL_MS));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            ticker.tick().await; // skip the immediate tick (setInterval fires after a period)
            loop {
                ticker.tick().await;
                emit_count(deps.as_ref(), &last_counts, &pid).await;
                shared.sweep_transcript_presence(&pid).await;
            }
        });
        self.scan_intervals
            .lock_recover()
            .insert(project_id.to_string(), handle);
    }

    /// Stop auto-scanning for a project.
    pub fn stop_auto_scan(&self, project_id: &str) {
        let handle = self.scan_intervals.lock_recover().remove(project_id);
        if let Some(handle) = handle {
            handle.abort();
            self.last_counts.lock_recover().remove(project_id);
        }
    }

    /// Stop all auto-scans (for shutdown).
    pub fn stop_all(&self) {
        let ids: Vec<String> = self.scan_intervals.lock_recover().keys().cloned().collect();
        for id in ids {
            self.stop_auto_scan(&id);
        }
    }
}

mod scan;
use scan::{emit_count, generate_import_title, scan_page_impl, strip_xml_tags};

#[cfg(test)]
mod tests;
