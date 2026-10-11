//! The `ChatStore` half of [`FakeDeps`]: an in-memory chat table that records
//! every write.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use mainframe_types::adapter::DetectedPr;
use mainframe_types::chat::{Chat, NewChat, ProcessState, TodoItem};
use mainframe_types::chat_patch::ChatPatch;
use mainframe_types::context::{SessionMention, SkillFileEntry};
use mainframe_types::seam_error::SeamError;

use super::FakeDeps;
use super::fake_rows::{fork_row, side_chat_row};
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
    /// Every PR `add_detected_prs` persisted, deduplicated by url.
    pub(crate) detected_prs: Mutex<Vec<DetectedPr>>,
    /// `db.chats.dismissedWorktrees` per chat id.
    pub(crate) dismissed: Mutex<HashMap<String, Vec<String>>>,
    /// Every `(chat_id, worktree_path)` `add_dismissed_worktree` was asked to write.
    pub(crate) dismiss_writes: Mutex<Vec<(String, String)>>,
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
    /// Persists the PRs not yet stored and returns those, as the repository does.
    fn add_detected_prs(&self, _chat_id: &str, prs: &[DetectedPr]) -> Vec<DetectedPr> {
        let mut stored = self.store.detected_prs.lock().unwrap();
        let fresh: Vec<DetectedPr> = prs
            .iter()
            .filter(|pr| stored.iter().all(|s| s.url != pr.url))
            .cloned()
            .collect();
        stored.extend(fresh.iter().cloned());
        fresh
    }
    fn get_dismissed_worktrees(&self, chat_id: &str) -> Vec<String> {
        self.store
            .dismissed
            .lock()
            .unwrap()
            .get(chat_id)
            .cloned()
            .unwrap_or_default()
    }
    fn add_dismissed_worktree(&self, chat_id: &str, worktree_path: &str) -> bool {
        self.store
            .dismiss_writes
            .lock()
            .unwrap()
            .push((chat_id.to_string(), worktree_path.to_string()));
        let mut dismissed = self.store.dismissed.lock().unwrap();
        let paths = dismissed.entry(chat_id.to_string()).or_default();
        if paths.iter().any(|p| p == worktree_path) {
            return false;
        }
        paths.push(worktree_path.to_string());
        true
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
