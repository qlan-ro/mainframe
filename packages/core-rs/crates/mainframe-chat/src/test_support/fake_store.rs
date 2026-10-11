//! The `ChatStore` half of [`FakeDeps`]: an in-memory chat table that records
//! every write.

use mainframe_types::sync::LockExt as _;
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
use crate::config_transcripts::OwnedNativeSession;
use crate::fork::PendingForkState;
use crate::segments::SegmentStore;
use crate::test_support::test_chat;

#[derive(Default)]
pub(crate) struct FakeChatStore {
    pub(crate) write_failure: Mutex<Option<String>>,
    pub(crate) owned_sessions: Mutex<Vec<crate::config_transcripts::OwnedNativeSession>>,
    pub(crate) native_paths: Arc<Mutex<Vec<(String, String)>>>,
    /// The chat rows, keyed by id, `sideChatId` NOT yet derived (raw DB row
    /// shape); reads apply `derive_side_chat_id` the way the DB subquery does.
    pub(crate) chats: Mutex<HashMap<String, Chat>>,
    /// Every `chats_create` input, in order.
    pub(crate) created: Mutex<Vec<NewChat>>,
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
        self.chats.lock_recover().insert(chat.id.clone(), chat);
    }

    /// Every stored row, raw (no `sideChatId`).
    pub(crate) fn raw_chats(&self) -> Vec<Chat> {
        self.chats.lock_recover().values().cloned().collect()
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
        let mut chats = self.chats.lock_recover();
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

#[path = "fake_store_impl.rs"]
mod implementation;
