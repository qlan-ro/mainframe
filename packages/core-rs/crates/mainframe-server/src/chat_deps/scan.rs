use super::*;

impl DaemonChatDeps {
    /// `scan_loaded_history` only receives the chatId (trait contract), so it
    /// re-derives a session from the same chat row `doLoadChat` already read
    /// rather than reusing the live one — both are stateless reads over the
    /// on-disk transcript, so results match. `scan_loaded_history` then reads
    /// this session twice, once via `load_history` (mentions) and once via
    /// `load_scan_records` (PRs) — for Claude, where `load_scan_records`
    /// defaults to `load_history`, that is the same file read twice; for
    /// Codex it is `thread/read` plus a rollout reconstruction (no app-server
    /// spawn). Correctness (the rollout's injected preamble
    /// must never feed the mention scan) outweighs the extra I/O here.
    pub(super) fn session_for_scan(&self, chat_id: &str) -> Option<Arc<dyn AdapterSession>> {
        let chat = match self.chats_get(chat_id) {
            Ok(chat) => chat?,
            Err(error) => {
                self.emit_storage_error(chat_id, error);
                return None;
            }
        };
        // An unsent fork has no `claude_session_id` yet; it scans
        // its pending fork's snapshot instead, same as every other session
        // builder (`build_history_session`/`do_load_chat`/`do_start_chat`).
        let own_id = chat.claude_session_id.clone();
        let fork_source = match ChatStore::get_pending_fork(self, chat_id) {
            Ok(value) => value.map(|p| p.fork_source),
            Err(error) => {
                self.emit_storage_error(chat_id, error);
                return None;
            }
        };
        if own_id.is_none() && fork_source.is_none() {
            return None;
        }
        let project_path = self.projects_get_path(&chat.project_id);
        let effective_path = mainframe_chat::chat_cwd::chat_cwd(
            chat.worktree_path.as_deref(),
            chat.scratch_path.as_deref(),
            project_path,
        )?;
        self.create_session(
            &chat.adapter_id,
            SessionOptions {
                project_path: effective_path,
                chat_id: own_id,
                mainframe_chat_id: chat_id.to_string(),
                session_file_path: chat.session_file_path.clone(),
                fork_source,
            },
        )
    }

    /// PR-URL scan over already-loaded history, then persist newly-detected
    /// PRs and emit `chat.prDetected` for each. PR-only: `@`-mention
    /// extraction is a separate scan (`scan_and_persist_mentions`) because the
    /// two need different history sources for Codex — see `scan_loaded_history`.
    pub(super) fn scan_and_persist_prs(&self, chat_id: &str, history: &[ChatMessage]) {
        let scanned = scan_history_for_prs(history);
        if scanned.is_empty() {
            return;
        }
        let persisted = match self.add_detected_prs(chat_id, &scanned) {
            Ok(value) => value,
            Err(error) => {
                self.emit_storage_error(chat_id, error);
                return;
            }
        };
        for pr in persisted {
            EventEmitter::emit_event(
                self,
                DaemonEvent::ChatPrDetected {
                    chat_id: chat_id.to_string(),
                    pr,
                },
            );
        }
    }

    /// `@`-mention extraction over already-loaded history. Split out of
    /// `scan_and_persist_prs` so it only ever runs against
    /// `load_history` — never `load_scan_records`, whose Codex rollout
    /// reconstruction injects a `role: "user"` preamble record
    /// (`<recommended_plugins>` + AGENTS.md/CLAUDE.md body) that `thread/read`
    /// never returns and that the mention extractor has no guard against.
    pub(super) fn scan_and_persist_mentions(&self, chat_id: &str, history: &[ChatMessage]) {
        let ctx_db = self.db.clone();
        if let Err(error) = scan_history_for_mentions(chat_id, history, &ctx_db) {
            self.emit_storage_error(chat_id, error);
        }
    }

    /// `Promise.all([extractPlanFiles(), extractSkillFiles()])` — either failing
    /// drops both (best-effort).
    pub(super) async fn persist_plan_and_skill_files(
        &self,
        chat_id: &str,
        session: &dyn AdapterSession,
    ) {
        let Ok((plan_paths, skill_paths)) =
            tokio::try_join!(session.extract_plan_files(), session.extract_skill_files())
        else {
            return;
        };
        for p in plan_paths {
            if let Err(error) = self.add_plan_file(chat_id, &p) {
                self.emit_storage_error(chat_id, error);
                return;
            }
        }
        for entry in skill_paths {
            if let Err(error) = self.add_skill_file(chat_id, &entry) {
                self.emit_storage_error(chat_id, error);
                return;
            }
        }
    }
}

/// `@`-mention extraction over user text — the first half of the post-load
/// history scan that `do_load_chat` runs through `scan_loaded_history`.
/// Persists each mention through `ctx_db` (`ContextDb::add_mention`) as a side
/// effect.
pub(super) fn scan_history_for_mentions(
    chat_id: &str,
    history: &[ChatMessage],
    ctx_db: &dyn ContextDb,
) -> Result<(), SeamError> {
    for msg in history {
        if msg.r#type != ChatMessageType::User {
            continue;
        }
        for block in &msg.content {
            let MessageContent::Leaf(LeafContent::Text { text, .. }) = block else {
                continue;
            };
            // Skip command/skill injections — they contain example @-patterns.
            if text.contains("<mainframe-command") || text.contains("<command-name>") {
                continue;
            }
            extract_mentions_from_text(chat_id, Some(text.as_str()), ctx_db)?;
        }
    }
    Ok(())
}
