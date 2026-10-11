use super::*;

impl ChatStore for FakeDeps {
    fn get_imported_session_ids(&self, project: &str) -> Result<Vec<String>, SeamError> {
        Ok(self
            .chats_list(project)?
            .into_iter()
            .filter_map(|c| c.claude_session_id)
            .collect())
    }
    fn find_by_external_session_id(
        &self,
        session: &str,
        project: &str,
    ) -> Result<Option<Chat>, SeamError> {
        Ok(self
            .chats_list(project)?
            .into_iter()
            .find(|c| c.claude_session_id.as_deref() == Some(session)))
    }
    fn owned_native_sessions(&self, chat_id: &str) -> Result<Vec<OwnedNativeSession>, SeamError> {
        Ok({
            if let Some(store) = self.segment_store() {
                return Ok(crate::test_support::fake_rows::owned_sessions(
                    store, chat_id,
                ));
            }
            self.store.owned_sessions.lock_recover().clone()
        })
    }
    fn set_native_session_file_path(&self, native_ref: &str, path: &str) -> Result<(), SeamError> {
        if let Some(store) = self.segment_store() {
            store.set_session_file_path(native_ref, path);
        }
        self.store
            .native_paths
            .lock_recover()
            .push((native_ref.into(), path.into()));

        Ok(())
    }

    fn chats_get(&self, id: &str) -> Result<Option<Chat>, SeamError> {
        Ok({
            let all = self.store.raw_chats();
            let Some(mut chat) = all.iter().find(|c| c.id == id).cloned() else {
                return Ok(None);
            };
            chat.side_chat_id = FakeChatStore::derive_side_chat_id(id, &all);
            Some(chat)
        })
    }
    fn chats_create(&self, new_chat: &NewChat) -> Result<Chat, SeamError> {
        if let Some(error) = self.store.write_failure.lock_recover().clone() {
            return Err(SeamError::msg(error));
        }
        Ok({
            self.store.created.lock_recover().push(new_chat.clone());
            // The repository persists before returning: offload-of-a-just-created
            // chat tests need `chats_get("new")` to find it afterward.
            let chat = test_chat("new");
            self.store.insert(chat.clone());
            chat
        })
    }
    fn chats_delete(&self, chat_id: &str) -> Result<(), SeamError> {
        self.store.chats.lock_recover().remove(chat_id);

        Ok(())
    }
    fn chats_update(&self, chat_id: &str, patch: &ChatPatch) -> Result<(), SeamError> {
        if let Some(error) = self.store.write_failure.lock_recover().clone() {
            return Err(SeamError::msg(error));
        }

        self.store
            .updates
            .lock_recover()
            .push((chat_id.to_string(), patch.clone()));
        self.store.update_row(chat_id, patch);

        Ok(())
    }
    fn chats_list(&self, _project_id: &str) -> Result<Vec<Chat>, SeamError> {
        Ok({
            self.store
                .with_derived_side_chat_ids(self.store.raw_chats())
        })
    }
    fn chats_list_all(&self) -> Result<Vec<Chat>, SeamError> {
        Ok({
            self.store
                .with_derived_side_chat_ids(self.store.raw_chats())
        })
    }
    fn chats_list_filtered(
        &self,
        _project_id: Option<&str>,
        _tags_all: Option<&[String]>,
        _has_worktree: bool,
        _include_archived: bool,
        _include_temporary: bool,
    ) -> Result<Vec<Chat>, SeamError> {
        Ok({
            self.store
                .with_derived_side_chat_ids(self.store.raw_chats())
        })
    }
    fn chats_add_mention(&self, chat_id: &str, mention: &SessionMention) -> Result<(), SeamError> {
        self.store
            .mentions
            .lock_recover()
            .push((chat_id.to_string(), mention.name.clone()));

        Ok(())
    }
    fn chats_reset_working_to_idle(&self) -> Result<i64, SeamError> {
        Ok({
            let mut count = 0;
            let mut chats = self.store.chats.lock_recover();
            for c in chats.values_mut() {
                if c.process_state == Some(Some(ProcessState::Working)) {
                    c.process_state = Some(Some(ProcessState::Idle));
                    count += 1;
                }
            }
            count
        })
    }
    fn add_plan_file(&self, _chat_id: &str, _file_path: &str) -> Result<bool, SeamError> {
        Ok(false)
    }
    fn add_skill_file(&self, _chat_id: &str, _entry: &SkillFileEntry) -> Result<bool, SeamError> {
        Ok(false)
    }
    fn update_todos(&self, _chat_id: &str, _todos: &[TodoItem]) -> Result<(), SeamError> {
        Ok(())
    }
    /// Persists the PRs not yet stored and returns those, as the repository does.
    fn add_detected_prs(
        &self,
        _chat_id: &str,
        prs: &[DetectedPr],
    ) -> Result<Vec<DetectedPr>, SeamError> {
        Ok({
            let mut stored = self.store.detected_prs.lock_recover();
            let fresh: Vec<DetectedPr> = prs
                .iter()
                .filter(|pr| stored.iter().all(|s| s.url != pr.url))
                .cloned()
                .collect();
            stored.extend(fresh.iter().cloned());
            fresh
        })
    }
    fn get_dismissed_worktrees(&self, chat_id: &str) -> Result<Vec<String>, SeamError> {
        Ok({
            self.store
                .dismissed
                .lock_recover()
                .get(chat_id)
                .cloned()
                .unwrap_or_default()
        })
    }
    fn add_dismissed_worktree(
        &self,
        chat_id: &str,
        worktree_path: &str,
    ) -> Result<bool, SeamError> {
        Ok({
            self.store
                .dismiss_writes
                .lock_recover()
                .push((chat_id.to_string(), worktree_path.to_string()));
            let mut dismissed = self.store.dismissed.lock_recover();
            let paths = dismissed.entry(chat_id.to_string()).or_default();
            if paths.iter().any(|p| p == worktree_path) {
                return Ok(false);
            }
            paths.push(worktree_path.to_string());
            true
        })
    }
    fn chats_clear_session(&self, chat_id: &str) -> Result<(), SeamError> {
        if let Some(c) = self.store.chats.lock_recover().get_mut(chat_id) {
            c.claude_session_id = None;
            c.session_file_path = None;
            c.transcript_missing = Some(false);
        }

        Ok(())
    }
    fn chats_clear_worktree(&self, chat_id: &str) -> Result<(), SeamError> {
        if let Some(c) = self.store.chats.lock_recover().get_mut(chat_id) {
            c.worktree_path = None;
            c.branch_name = None;
        }

        Ok(())
    }
    fn mark_context_lost(&self, chat_id: &str, context_lost_at: &str) -> Result<(), SeamError> {
        self.store
            .mark_context_lost_calls
            .lock_recover()
            .push((chat_id.to_string(), context_lost_at.to_string()));
        if let Some(c) = self.store.chats.lock_recover().get_mut(chat_id) {
            c.context_lost_at = Some(context_lost_at.to_string());
            c.claude_session_id = None;
            c.session_file_path = None;
            c.vendor_session_ephemeral = false;
        }

        Ok(())
    }
    fn create_fork(&self, insert: &ForkCreateInput) -> Result<Chat, SeamError> {
        if let Some(message) = self.store.create_fork_failure.lock_recover().clone() {
            return Err(SeamError::msg(message));
        }
        self.store.fork_inserts.lock_recover().push(insert.clone());
        let id = format!("fork-{}", self.store.chats.lock_recover().len());
        let chat = fork_row(&id, insert);
        self.store.insert(chat.clone());
        self.store
            .pending_forks
            .lock_recover()
            .insert(id, insert.pending_fork.clone());
        Ok(chat)
    }
    fn get_pending_fork(&self, chat_id: &str) -> Result<Option<PendingForkState>, SeamError> {
        Ok({
            self.store
                .pending_forks
                .lock_recover()
                .get(chat_id)
                .cloned()
        })
    }
    fn clear_pending_fork(&self, chat_id: &str) -> Result<(), SeamError> {
        self.store.pending_forks.lock_recover().remove(chat_id);

        Ok(())
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
