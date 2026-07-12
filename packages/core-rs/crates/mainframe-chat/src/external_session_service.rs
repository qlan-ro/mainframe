//! Ported from `packages/core/src/chat/external-session-service.ts`.

use std::cmp::Ordering;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use mainframe_adapter_api::{AdapterError, BoxFuture};
use mainframe_types::adapter::{ExternalSession, ExternalSessionPage};
use mainframe_types::chat::{Chat, ChatStatus, Project};
use mainframe_types::events::DaemonEvent;
use tokio::task::JoinHandle;
use tracing::{info, warn};

use crate::title_generator::derive_title_from_message;

/// 5 minutes.
const SCAN_INTERVAL_MS: u64 = 5 * 60 * 1000;

/// A partial `Chat` patch used by the import + title paths (`Partial<Chat>`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ExternalChatUpdate {
    pub claude_session_id: Option<String>,
    pub title: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

/// Injected surface — the `db.*` / `adapters.*` reads the service makes.
///
/// `adapters.getAll().filter(a => a.listExternalSessions)` becomes
/// `external_session_adapter_ids()` + `list_external_sessions(...)`; the
/// `listExternalSessions` adapter method is not yet on the ported Adapter trait
/// (adapter-api TODO), so it is abstracted here.
pub trait ExternalSessionDeps: Send + Sync {
    fn projects_get(&self, project_id: &str) -> Option<Project>;
    fn get_imported_session_ids(&self, project_id: &str) -> Vec<String>;
    fn find_by_external_session_id(&self, session_id: &str, project_id: &str) -> Option<Chat>;
    fn chats_create(&self, project_id: &str, adapter_id: &str) -> Chat;
    fn chats_update(&self, chat_id: &str, updates: &ExternalChatUpdate);
    /// `db.chats.list(projectId)` — used by the transcript-presence sweep.
    fn chats_list(&self, project_id: &str) -> Vec<Chat>;
    fn settings_get(&self, ns: &str, key: &str) -> Option<String>;
    fn emit_event(&self, event: DaemonEvent);
    /// Adapter-aware title generation (`adapters.get(adapterId)?.generateTitle`).
    /// `None` when the owning adapter has no `generateTitle` (deterministic import
    /// title stands). Main catch-up (#430): title gen moved onto the adapter.
    fn generate_title<'a>(
        &'a self,
        adapter_id: &'a str,
        content: &'a str,
        binary: &'a str,
    ) -> BoxFuture<'a, Option<String>>;
    /// `ChatManager.reconcileTranscript` — flags chats whose transcript vanished
    /// (degraded-chat sweep). `None` = no callback wired (the sweep is a no-op).
    fn reconcile_transcript<'a>(&'a self, _chat: &'a Chat) -> Option<BoxFuture<'a, bool>> {
        None
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
    scan_intervals: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    last_counts: Arc<Mutex<HashMap<String, i64>>>,
}

impl<D: ExternalSessionDeps + 'static> ExternalSessionService<D> {
    pub fn new(deps: Arc<D>) -> Self {
        Self {
            deps,
            scan_intervals: Arc::new(Mutex::new(HashMap::new())),
            last_counts: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Reconcile transcript presence for every non-archived chat of the project
    /// that has a CLI session id, so the sidebar degraded marker appears without
    /// the chat being opened. Runs on the same cadence as the auto-scan.
    pub async fn sweep_transcript_presence(&self, project_id: &str) {
        sweep_transcript_presence_impl(self.deps.as_ref(), project_id).await;
    }

    /// Page of importable external sessions merged and sorted across all adapters for a project.
    pub async fn scan_page(
        &self,
        project_id: &str,
        offset: i64,
        limit: i64,
    ) -> ExternalSessionPage {
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
    ) -> Chat {
        if let Some(existing) = self
            .deps
            .find_by_external_session_id(session_id, project_id)
        {
            return existing;
        }

        let mut chat = self.deps.chats_create(project_id, adapter_id);
        let mut updates = ExternalChatUpdate {
            claude_session_id: Some(session_id.to_string()),
            ..Default::default()
        };

        // Strip XML-like tags from the title (e.g. <command-message>, <local-command-caveat>)
        let clean_title = title.map(strip_xml_tags).filter(|s| !s.is_empty());
        if let Some(ct) = &clean_title {
            updates.title = Some(derive_title_from_message(ct));
        }

        if let Some(created) = created_at {
            updates.created_at = Some(created.to_string());
        }
        if let Some(modified) = modified_at {
            updates.updated_at = Some(modified.to_string());
        }
        self.deps.chats_update(&chat.id, &updates);
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
            let adapter_id = adapter_id.to_string();
            tokio::spawn(async move {
                generate_import_title(deps.as_ref(), &mut chat_for_title, &ct, &adapter_id).await;
            });
        }

        chat
    }

    /// Start auto-scanning for a project (on project open).
    pub fn start_auto_scan(&self, project_id: &str) {
        self.stop_auto_scan(project_id);

        // Initial scan (fire-and-forget). scan_page never rejects (per-adapter
        // errors are logged inside), so the TS `.catch('Initial…failed')` guard is
        // structurally unreachable and elided.
        {
            let deps = self.deps.clone();
            let last_counts = self.last_counts.clone();
            let pid = project_id.to_string();
            tokio::spawn(async move {
                emit_count(deps.as_ref(), &last_counts, &pid).await;
                sweep_transcript_presence_impl(deps.as_ref(), &pid).await;
            });
        }

        let deps = self.deps.clone();
        let last_counts = self.last_counts.clone();
        let pid = project_id.to_string();
        let handle = tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_millis(SCAN_INTERVAL_MS));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            ticker.tick().await; // skip the immediate tick (setInterval fires after a period)
            loop {
                ticker.tick().await;
                emit_count(deps.as_ref(), &last_counts, &pid).await;
                sweep_transcript_presence_impl(deps.as_ref(), &pid).await;
            }
        });
        self.scan_intervals
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(project_id.to_string(), handle);
    }

    /// Stop auto-scanning for a project.
    pub fn stop_auto_scan(&self, project_id: &str) {
        let handle = self
            .scan_intervals
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(project_id);
        if let Some(handle) = handle {
            handle.abort();
            self.last_counts
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(project_id);
        }
    }

    /// Stop all auto-scans (for shutdown).
    pub fn stop_all(&self) {
        let ids: Vec<String> = self
            .scan_intervals
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .keys()
            .cloned()
            .collect();
        for id in ids {
            self.stop_auto_scan(&id);
        }
    }
}

async fn scan_page_impl<D: ExternalSessionDeps>(
    deps: &D,
    project_id: &str,
    offset: i64,
    limit: i64,
) -> ExternalSessionPage {
    let Some(project) = deps.projects_get(project_id) else {
        return ExternalSessionPage {
            sessions: Vec::new(),
            total: 0,
            next_offset: None,
        };
    };

    let adapter_ids = deps.external_session_adapter_ids();
    let exclude_ids = deps.get_imported_session_ids(project_id);

    // Count-only: each adapter returns its total without enriching.
    if limit <= 0 {
        let mut total = 0;
        for adapter_id in &adapter_ids {
            match deps
                .list_external_sessions(adapter_id, &project.path, &exclude_ids, 0, 0)
                .await
            {
                Ok(page) => total += page.total,
                Err(err) => {
                    warn!(
                        ?err,
                        adapter_id, project_id, "Failed to count external sessions"
                    )
                }
            }
        }
        return ExternalSessionPage {
            sessions: Vec::new(),
            total,
            next_offset: None,
        };
    }

    // Over-fetch each adapter's prefix [0, offset+limit), then merge-sort across
    // adapters by modifiedAt desc and slice the requested page. This is correct
    // for any number of session-listing adapters (claude + codex today).
    let prefix_limit = offset + limit;
    let mut collected: Vec<ExternalSession> = Vec::new();
    let mut total = 0;
    for adapter_id in &adapter_ids {
        match deps
            .list_external_sessions(adapter_id, &project.path, &exclude_ids, 0, prefix_limit)
            .await
        {
            Ok(mut page) => {
                for s in &mut page.sessions {
                    s.adapter_id = adapter_id.clone();
                }
                total += page.total;
                collected.extend(page.sessions);
            }
            Err(err) => {
                warn!(
                    ?err,
                    adapter_id, project_id, "Failed to scan external sessions"
                )
            }
        }
    }

    collected.sort_by(|a, b| {
        let d = parse_ms(&b.modified_at) - parse_ms(&a.modified_at);
        if d != 0 {
            if d > 0 {
                Ordering::Greater
            } else {
                Ordering::Less
            }
        } else if a.session_id < b.session_id {
            Ordering::Greater
        } else {
            Ordering::Less
        }
    });

    let len = collected.len() as i64;
    let start = offset.clamp(0, len) as usize;
    let end = (offset + limit).clamp(0, len) as usize;
    let sessions = collected[start..end].to_vec();
    let next_offset = if offset + limit < total {
        Some(offset + limit)
    } else {
        None
    };
    ExternalSessionPage {
        sessions,
        total,
        next_offset,
    }
}

async fn generate_import_title<D: ExternalSessionDeps>(
    deps: &D,
    chat: &mut Chat,
    content: &str,
    adapter_id: &str,
) {
    if deps
        .settings_get("general", "titleGeneration.disabled")
        .as_deref()
        == Some("true")
    {
        return;
    }

    let binary = deps
        .settings_get("provider", &format!("{adapter_id}.titleBinary"))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "claude".to_string());
    let Some(title) = deps.generate_title(adapter_id, content, &binary).await else {
        return;
    };

    chat.title = Some(title.clone());
    deps.chats_update(
        &chat.id,
        &ExternalChatUpdate {
            title: Some(title),
            ..Default::default()
        },
    );
    deps.emit_event(DaemonEvent::ChatUpdated {
        chat: chat.clone(),
        reason: None,
    });
}

/// The transcript-presence sweep body, shared by the public method and the
/// auto-scan tasks.
async fn sweep_transcript_presence_impl<D: ExternalSessionDeps>(deps: &D, project_id: &str) {
    let candidates: Vec<Chat> = deps
        .chats_list(project_id)
        .into_iter()
        .filter(|c| c.status != ChatStatus::Archived && c.claude_session_id.is_some())
        .collect();
    for chat in candidates {
        if let Some(fut) = deps.reconcile_transcript(&chat) {
            let _ = fut.await;
        }
    }
}

async fn emit_count<D: ExternalSessionDeps>(
    deps: &D,
    last_counts: &Mutex<HashMap<String, i64>>,
    project_id: &str,
) {
    let page = scan_page_impl(deps, project_id, 0, 0).await; // count-only (no enrichment)
    let total = page.total;
    let last = last_counts
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(project_id)
        .copied();
    if last != Some(total) {
        last_counts
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(project_id.to_string(), total);
        deps.emit_event(DaemonEvent::SessionsExternalCount {
            project_id: project_id.to_string(),
            count: total,
        });
    }
}

/// `new Date(s).getTime()` — parse an ISO-8601 timestamp to epoch ms (0 on failure).
fn parse_ms(s: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|d| d.timestamp_millis())
        .unwrap_or(0)
}

/// Remove XML-like tags and collapse whitespace, returning empty string if nothing remains.
fn strip_xml_tags(text: &str) -> String {
    // /<[^>]+>/g → ' ', then /\s+/g → ' ', trim.
    let chars: Vec<char> = text.chars().collect();
    let mut without_tags = String::new();
    let mut i = 0;
    while i < chars.len() {
        // `<[^>]+>` — `<`, then ≥1 non-`>` char, then `>`. A bare `<>` or an
        // unclosed `<` is not a tag and is preserved.
        if chars[i] == '<'
            && let Some(close_rel) = chars[i + 1..].iter().position(|c| *c == '>')
            && close_rel >= 1
        {
            without_tags.push(' ');
            i = i + 1 + close_rel + 1;
            continue;
        }
        without_tags.push(chars[i]);
        i += 1;
    }
    // collapse whitespace runs to a single space, trim
    let mut out = String::new();
    let mut prev_ws = false;
    for c in without_tags.chars() {
        if c.is_whitespace() {
            if !prev_ws {
                out.push(' ');
                prev_ws = true;
            }
        } else {
            out.push(c);
            prev_ws = false;
        }
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_chat;
    use std::sync::Mutex as StdMutex;

    #[derive(Default)]
    struct SweepDeps {
        chats: Vec<Chat>,
        has_reconcile: bool,
        reconcile_calls: StdMutex<Vec<String>>,
    }
    impl ExternalSessionDeps for SweepDeps {
        fn projects_get(&self, _project_id: &str) -> Option<Project> {
            None
        }
        fn get_imported_session_ids(&self, _project_id: &str) -> Vec<String> {
            Vec::new()
        }
        fn find_by_external_session_id(&self, _sid: &str, _pid: &str) -> Option<Chat> {
            None
        }
        fn chats_create(&self, _project_id: &str, _adapter_id: &str) -> Chat {
            test_chat("new")
        }
        fn chats_update(&self, _chat_id: &str, _updates: &ExternalChatUpdate) {}
        fn chats_list(&self, _project_id: &str) -> Vec<Chat> {
            self.chats.clone()
        }
        fn settings_get(&self, _ns: &str, _key: &str) -> Option<String> {
            None
        }
        fn emit_event(&self, _event: DaemonEvent) {}
        fn generate_title<'a>(
            &'a self,
            _adapter_id: &'a str,
            _content: &'a str,
            _binary: &'a str,
        ) -> BoxFuture<'a, Option<String>> {
            Box::pin(async { None })
        }
        fn reconcile_transcript<'a>(&'a self, chat: &'a Chat) -> Option<BoxFuture<'a, bool>> {
            if !self.has_reconcile {
                return None;
            }
            let id = chat.id.clone();
            Some(Box::pin(async move {
                self.reconcile_calls
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .push(id);
                false
            }))
        }
        fn external_session_adapter_ids(&self) -> Vec<String> {
            Vec::new()
        }
        fn list_external_sessions<'a>(
            &'a self,
            _adapter_id: &'a str,
            _project_path: &'a str,
            _exclude_ids: &'a [String],
            _offset: i64,
            _limit: i64,
        ) -> BoxFuture<'a, Result<ExternalSessionPage, AdapterError>> {
            Box::pin(async {
                Ok(ExternalSessionPage {
                    sessions: Vec::new(),
                    total: 0,
                    next_offset: None,
                })
            })
        }
    }

    fn chat(id: &str, session: Option<&str>, status: ChatStatus) -> Chat {
        let mut c = test_chat(id);
        c.claude_session_id = session.map(str::to_string);
        c.status = status;
        c
    }

    #[tokio::test]
    async fn reconciles_every_non_archived_chat_with_a_cli_session_id() {
        let deps = Arc::new(SweepDeps {
            chats: vec![
                chat("with-session", Some("sess-a"), ChatStatus::Active),
                chat("draft", None, ChatStatus::Active),
                chat("archived", Some("sess-b"), ChatStatus::Archived),
            ],
            has_reconcile: true,
            reconcile_calls: StdMutex::new(Vec::new()),
        });
        let service = ExternalSessionService::new(deps.clone());

        service.sweep_transcript_presence("p1").await;

        let calls = deps
            .reconcile_calls
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        assert_eq!(calls.as_slice(), ["with-session"]);
    }

    #[tokio::test]
    async fn no_op_when_no_reconcile_callback_provided() {
        let deps = Arc::new(SweepDeps {
            chats: vec![chat("with-session", Some("sess-a"), ChatStatus::Active)],
            has_reconcile: false,
            reconcile_calls: StdMutex::new(Vec::new()),
        });
        let service = ExternalSessionService::new(deps.clone());
        service.sweep_transcript_presence("p1").await;
        assert!(
            deps.reconcile_calls
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .is_empty()
        );
    }
}

// PORT STATUS: src/chat/external-session-service.ts (198 lines)
// confidence: medium
// todos: 0
// notes: Main catch-up (#424/#430): `sweepTranscriptPresence` (non-archived + has
// notes: sessionId, reconcile each) runs on the auto-scan cadence (initial + every
// notes: tick); the optional `reconcileTranscript` callback → a defaulted
// notes: `reconcile_transcript` deps method (`None` = no-op sweep). Title gen is now
// notes: adapter-aware via the `generate_title(adapterId,...)` deps method (the free
// notes: `title_generator::generate_title` moved to the Claude adapter). external-
// notes: session-sweep.test.ts ported ×2.
// notes: TS DI (db + AdapterRegistry) → `ExternalSessionDeps` trait. The adapter
// notes: `listExternalSessions` method is not yet on the ported Adapter trait, so
// notes: `external_session_adapter_ids` + `list_external_sessions` abstract it.
// notes: scanIntervals/lastCounts → `Arc<Mutex<HashMap<..>>>` (CONCURRENCY.tsv
// notes: SHARED_MAP); `setInterval` → a spawned tokio interval task per project
// notes: (JoinHandle aborted on stop). Merge-sort comparator (modifiedAt desc,
// notes: sessionId desc tie-break) copied exactly; slice bounds clamped like JS
// notes: `Array.slice`. Fire-and-forget title gen → `tokio::spawn`. The outer
// notes: scanPage `.catch` guards are unreachable (deps don't throw) and elided.
// notes: The only ported test is external-session-sweep.test.ts (the scan/import
// notes: paths have no TS test file).
