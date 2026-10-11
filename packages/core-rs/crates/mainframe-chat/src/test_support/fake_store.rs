//! The `ChatStore` half of [`FakeDeps`]: an in-memory chat table that records
//! every write.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use mainframe_types::adapter::DetectedPr;
use mainframe_types::chat::{Chat, ChatStatus, NewChat, ProcessState, TodoItem};
use mainframe_types::chat_patch::ChatPatch;
use mainframe_types::context::{SessionMention, SkillFileEntry};
use mainframe_types::seam_error::SeamError;

use super::FakeDeps;
use crate::chat_manager::{ChatStore, ForkCreateInput};
use crate::fork::PendingForkState;
use crate::segments::SegmentStore;
use crate::test_support::test_chat;

#[derive(Default)]
pub(crate) struct FakeChatStore {
    /// The chat rows, keyed by id, `sideChatId` NOT yet derived (raw DB row
    /// shape); reads apply `derive_side_chat_id` the way the DB subquery does.
    pub(crate) chats: Mutex<HashMap<String, Chat>>,
    /// Every `chats_update` call, in order.
    pub(crate) updates: Mutex<Vec<(String, ChatPatch)>>,
    /// Every `(chat_id, mention name)` `chats_add_mention` recorded.
    pub(crate) mentions: Mutex<Vec<(String, String)>>,
    /// Every `mark_context_lost(chat_id, context_lost_at)` call, in order.
    pub(crate) mark_context_lost_calls: Mutex<Vec<(String, String)>>,
    /// When `Some`, `create_fork` fails with this message instead of inserting.
    pub(crate) create_fork_failure: Mutex<Option<String>>,
    /// Every `create_fork` input, so tests can assert the copied segments.
    pub(crate) fork_inserts: Mutex<Vec<ForkCreateInput>>,
    /// `db.chats.pendingFork` per chat id.
    pub(crate) pending_forks: Mutex<HashMap<String, PendingForkState>>,
    /// `segment_store()` — set once by the provider-switch tests; every other
    /// test leaves it unset (single-segment chats, as before segments existed).
    pub(crate) segment_store: OnceLock<Arc<dyn SegmentStore>>,
}

impl FakeChatStore {
    pub(crate) fn insert(&self, chat: Chat) {
        self.chats.lock().unwrap().insert(chat.id.clone(), chat);
    }

    /// Every stored row, raw (no `sideChatId`).
    pub(crate) fn raw_chats(&self) -> Vec<Chat> {
        self.chats.lock().unwrap().values().cloned().collect()
    }

    /// Mirrors the DB's correlated `sideChatId` subquery: the id of the (at
    /// most one) temporary chat in `all` whose `parent_chat_id` is `chat_id`.
    fn derive_side_chat_id(chat_id: &str, all: &[Chat]) -> Option<String> {
        all.iter()
            .find(|c| {
                c.temporary && c.parent_chat_id.as_ref().and_then(|p| p.as_deref()) == Some(chat_id)
            })
            .map(|c| c.id.clone())
    }

    fn with_derived_side_chat_ids(&self, mut chats: Vec<Chat>) -> Vec<Chat> {
        let snapshot = chats.clone();
        for c in &mut chats {
            c.side_chat_id = Self::derive_side_chat_id(&c.id, &snapshot);
        }
        chats
    }

    fn update_row(&self, chat_id: &str, patch: &ChatPatch) {
        let mut chats = self.chats.lock().unwrap();
        let Some(c) = chats.get_mut(chat_id) else {
            return;
        };
        if let Some(ps) = patch.process_state {
            c.process_state = Some(ps);
        }
        if let Some(tm) = patch.transcript_missing {
            c.transcript_missing = Some(tm);
        }
        if let Some(title) = patch.title.clone() {
            c.title = Some(title);
        }
        if let Some(vse) = patch.vendor_session_ephemeral {
            c.vendor_session_ephemeral = vse;
        }
        if let Some(model) = patch.model.clone() {
            c.model = Some(model);
        }
        if let Some(worktree_path) = patch.worktree_path.clone() {
            c.worktree_path = worktree_path;
        }
        if let Some(branch_name) = patch.branch_name.clone() {
            c.branch_name = branch_name;
        }
    }
}

impl ChatStore for FakeDeps {
    fn chats_get(&self, id: &str) -> Option<Chat> {
        let all = self.store.raw_chats();
        let mut chat = all.iter().find(|c| c.id == id)?.clone();
        chat.side_chat_id = FakeChatStore::derive_side_chat_id(id, &all);
        Some(chat)
    }
    fn chats_create(&self, _new_chat: &NewChat) -> Chat {
        // The repository persists before returning: offload-of-a-just-created
        // chat tests need `chats_get("new")` to find it afterward.
        let chat = test_chat("new");
        self.store.insert(chat.clone());
        chat
    }
    fn chats_delete(&self, chat_id: &str) {
        self.store.chats.lock().unwrap().remove(chat_id);
    }
    fn chats_update(&self, chat_id: &str, patch: &ChatPatch) {
        self.store
            .updates
            .lock()
            .unwrap()
            .push((chat_id.to_string(), patch.clone()));
        self.store.update_row(chat_id, patch);
    }
    fn chats_list(&self, _project_id: &str) -> Vec<Chat> {
        self.store
            .with_derived_side_chat_ids(self.store.raw_chats())
    }
    fn chats_list_all(&self) -> Vec<Chat> {
        self.store
            .with_derived_side_chat_ids(self.store.raw_chats())
    }
    fn chats_list_filtered(
        &self,
        _project_id: Option<&str>,
        _tags_all: Option<&[String]>,
        _has_worktree: bool,
        _include_archived: bool,
        _include_temporary: bool,
    ) -> Vec<Chat> {
        self.store
            .with_derived_side_chat_ids(self.store.raw_chats())
    }
    fn chats_add_mention(&self, chat_id: &str, mention: &SessionMention) {
        self.store
            .mentions
            .lock()
            .unwrap()
            .push((chat_id.to_string(), mention.name.clone()));
    }
    fn chats_reset_working_to_idle(&self) -> i64 {
        let mut count = 0;
        let mut chats = self.store.chats.lock().unwrap();
        for c in chats.values_mut() {
            if c.process_state == Some(Some(ProcessState::Working)) {
                c.process_state = Some(Some(ProcessState::Idle));
                count += 1;
            }
        }
        count
    }
    fn add_plan_file(&self, _chat_id: &str, _file_path: &str) -> bool {
        false
    }
    fn add_skill_file(&self, _chat_id: &str, _entry: &SkillFileEntry) -> bool {
        false
    }
    fn update_todos(&self, _chat_id: &str, _todos: &[TodoItem]) {}
    fn add_detected_prs(&self, _chat_id: &str, _prs: &[DetectedPr]) -> Vec<DetectedPr> {
        Vec::new()
    }
    fn chats_clear_session(&self, chat_id: &str) {
        if let Some(c) = self.store.chats.lock().unwrap().get_mut(chat_id) {
            c.claude_session_id = None;
            c.session_file_path = None;
            c.transcript_missing = Some(false);
        }
    }
    fn chats_clear_worktree(&self, chat_id: &str) {
        if let Some(c) = self.store.chats.lock().unwrap().get_mut(chat_id) {
            c.worktree_path = None;
            c.branch_name = None;
        }
    }
    fn mark_context_lost(&self, chat_id: &str, context_lost_at: &str) {
        self.store
            .mark_context_lost_calls
            .lock()
            .unwrap()
            .push((chat_id.to_string(), context_lost_at.to_string()));
        if let Some(c) = self.store.chats.lock().unwrap().get_mut(chat_id) {
            c.context_lost_at = Some(context_lost_at.to_string());
            c.claude_session_id = None;
            c.session_file_path = None;
            c.vendor_session_ephemeral = false;
        }
    }
    fn create_fork(&self, insert: &ForkCreateInput) -> Result<Chat, SeamError> {
        if let Some(message) = self.store.create_fork_failure.lock().unwrap().clone() {
            return Err(SeamError::msg(message));
        }
        self.store.fork_inserts.lock().unwrap().push(insert.clone());
        let id = format!("fork-{}", self.store.chats.lock().unwrap().len());
        let chat = fork_row(&id, insert);
        self.store.insert(chat.clone());
        self.store
            .pending_forks
            .lock()
            .unwrap()
            .insert(id, insert.pending_fork.clone());
        Ok(chat)
    }
    fn get_pending_fork(&self, chat_id: &str) -> Option<PendingForkState> {
        self.store
            .pending_forks
            .lock()
            .unwrap()
            .get(chat_id)
            .cloned()
    }
    fn clear_pending_fork(&self, chat_id: &str) {
        self.store.pending_forks.lock().unwrap().remove(chat_id);
    }
    fn segment_store(&self) -> Option<&dyn SegmentStore> {
        self.store.segment_store.get().map(|store| store.as_ref())
    }
    fn chats_find_or_create_side_chat(&self, parent: &Chat) -> Result<(Chat, bool), SeamError> {
        let all = self.store.raw_chats();
        if let Some(existing_id) = FakeChatStore::derive_side_chat_id(&parent.id, &all)
            && let Some(existing) = all.iter().find(|c| c.id == existing_id)
        {
            return Ok((existing.clone(), false));
        }
        let side_chat = side_chat_row(&format!("side-{}", nanoid::nanoid!()), parent);
        self.store.insert(side_chat.clone());
        Ok((side_chat, true))
    }
}

/// The row `create_fork` inserts: the fork's config copied from `insert`.
fn fork_row(id: &str, insert: &ForkCreateInput) -> Chat {
    let mut chat = test_chat(id);
    chat.adapter_id = insert.adapter_id.clone();
    chat.project_id = insert.project_id.clone();
    chat.title = insert.title.clone();
    chat.model = insert.model.clone();
    chat.permission_mode = insert.permission_mode;
    chat.plan_mode = Some(insert.plan_mode);
    chat.status = ChatStatus::Active;
    chat.created_at = "2026-01-01T00:00:00.000Z".to_string();
    chat.updated_at = "2026-01-01T00:00:00.000Z".to_string();
    chat.worktree_path = insert.worktree_path.clone();
    chat.branch_name = insert.branch_name.clone();
    chat.tuning = mainframe_types::chat::SessionTuning {
        effort: Some(insert.effort),
        fast: Some(insert.fast),
        ultracode: Some(insert.ultracode),
        adaptive_thinking: Some(insert.adaptive_thinking),
    };
    chat.parent_chat_id = Some(Some(insert.parent_chat_id.clone()));
    chat
}

/// The temporary side-chat row the repository creates under `parent`.
fn side_chat_row(id: &str, parent: &Chat) -> Chat {
    let now = "2026-01-01T00:00:00.000Z".to_string();
    let mut chat = test_chat(id);
    chat.adapter_id = parent.adapter_id.clone();
    chat.project_id = parent.project_id.clone();
    chat.model = parent.model.clone();
    chat.permission_mode = parent.permission_mode;
    chat.plan_mode = parent.plan_mode;
    chat.created_at = now.clone();
    chat.updated_at = now;
    chat.worktree_path = parent.worktree_path.clone();
    chat.branch_name = parent.branch_name.clone();
    chat.temporary = true;
    chat.no_project = parent.no_project;
    chat.scratch_path = parent.scratch_path.clone();
    chat.parent_chat_id = Some(Some(parent.id.clone()));
    chat
}
