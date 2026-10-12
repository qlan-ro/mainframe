use super::*;

impl SessionSinkImpl {
    pub(super) fn handle_compact(&self, vendor_id: Option<&str>) {
        let message = self.transient_with_id(
            ChatMessageType::System,
            vec![MessageContent::Node(MessageContentNode::Compaction {
                parent_tool_use_id: None,
            })],
            None,
            vendor_id.map(str::to_string),
        );
        self.messages.lock_recover().append(&self.chat_id, message);
        self.notify_surface(ChatSurfaceEvent::Compaction {
            chat_id: self.chat_id.clone(),
            phase: CompactionPhase::Done,
        });
        self.emit_display();
    }

    pub(super) fn handle_compact_start(&self) {
        self.notify_surface(ChatSurfaceEvent::Compaction {
            chat_id: self.chat_id.clone(),
            phase: CompactionPhase::Started,
        });
    }

    pub(super) fn handle_context_usage(&self, usage: ContextUsage) {
        // Persist the CLI's own totals so the meter survives reloads and
        // dormant-chat turns instead of regressing to a catalog-window guess
        // (#197). `chat.updated` is broadcast ungated (unlike chat.contextUsage,
        // which only reaches subscribers), so unsubscribed clients converge too.
        if usage.max_tokens > 0 {
            let patch = ChatPatch {
                last_context_total_tokens: Some(usage.total_tokens as u64),
                last_context_max_tokens: Some(usage.max_tokens as u64),
                ..Default::default()
            };
            if let Some(cell) = self.shared.active(&self.chat_id) {
                let chat = {
                    let mut guard = cell.lock_recover();
                    guard.chat.last_context_total_tokens = Some(usage.total_tokens as u64);
                    guard.chat.last_context_max_tokens = Some(usage.max_tokens as u64);
                    guard.chat.clone()
                };
                self.shared
                    .prepare_live_update(&self.chat_id, &patch)
                    .emit(chat, None);
            } else {
                self.shared.best_effort(
                    &self.chat_id,
                    self.shared.deps.chats_update(&self.chat_id, &patch),
                    (),
                );
            }
        }
        self.notify_surface(ChatSurfaceEvent::Usage {
            chat_id: self.chat_id.clone(),
            usage,
        });
    }

    pub(super) fn handle_plan_file(&self, file_path: &str) {
        if storage_event!(
            self.shared, Some(&self.chat_id);
            self.shared.deps.add_plan_file(&self.chat_id, file_path)
        ) {
            self.shared.emit(DaemonEvent::ContextUpdated {
                chat_id: self.chat_id.clone(),
                file_paths: None,
            });
        }
    }

    pub(super) fn handle_skill_file(&self, entry: SkillFileEntry) {
        if storage_event!(
            self.shared, Some(&self.chat_id);
            self.shared.deps.add_skill_file(&self.chat_id, &entry)
        ) {
            self.shared.emit(DaemonEvent::ContextUpdated {
                chat_id: self.chat_id.clone(),
                file_paths: None,
            });
        }
    }

    pub(super) fn handle_todo_update(&self, todos: Vec<TodoItem>) {
        self.shared.best_effort(
            &self.chat_id,
            self.shared.deps.update_todos(&self.chat_id, &todos),
            (),
        );
        if let Some(cell) = self.shared.active(&self.chat_id) {
            cell.lock_recover().chat.todos = Some(todos.clone());
        }
        self.shared.emit(DaemonEvent::TodosUpdated {
            chat_id: self.chat_id.clone(),
            todos,
        });
    }

    pub(super) fn handle_pr_detected(&self, pr: DetectedPr) {
        let persisted = self.shared.best_effort(
            &self.chat_id,
            self.shared
                .deps
                .add_detected_prs(&self.chat_id, std::slice::from_ref(&pr)),
            vec![pr.clone()],
        );
        let Some(first) = persisted.into_iter().next() else {
            return;
        };
        self.shared.emit(DaemonEvent::ChatPrDetected {
            chat_id: self.chat_id.clone(),
            pr: first,
        });
    }
    pub(super) fn handle_init(&self, session_id: &str) {
        let Some(cell) = self.shared.active(&self.chat_id) else {
            return;
        };
        let (project_id, adapter_id, worktree_path, scratch_path, session_process_id) = {
            let mut guard = cell.lock_recover();
            guard.chat.vendor_session_id = Some(session_id.to_string());
            (
                guard.chat.project_id.clone(),
                guard.chat.adapter_id.clone(),
                guard.chat.worktree_path.clone(),
                guard.chat.scratch_path.clone(),
                guard.session.as_ref().map(|s| s.id().to_string()),
            )
        };
        self.shared.best_effort(
            &self.chat_id,
            self.shared.deps.chats_update(
                &self.chat_id,
                &ChatPatch {
                    vendor_session_id: Some(session_id.to_string()),
                    ..Default::default()
                },
            ),
            (),
        );
        self.sync_active_divider();
        let project_path = self.shared.deps.projects_get_path(&project_id);
        let cwd = crate::chat_cwd::chat_cwd(
            worktree_path.as_deref(),
            scratch_path.as_deref(),
            project_path,
        );
        self.persist_initial_transcript(&cell, &adapter_id, session_id, cwd.as_deref());
        self.shared.emit(DaemonEvent::ProcessReady {
            process_id: session_process_id.unwrap_or_default(),
            vendor_session_id: session_id.to_string(),
        });
    }
    fn persist_initial_transcript(
        &self,
        cell: &std::sync::Arc<std::sync::Mutex<crate::types::ActiveChat>>,
        adapter_id: &str,
        session_id: &str,
        cwd: Option<&str>,
    ) {
        if let Some(session_file_path) = cwd.and_then(|cwd| {
            self.shared
                .deps
                .initial_transcript_path(adapter_id, session_id, cwd)
        }) {
            self.shared.best_effort(
                &self.chat_id,
                self.shared.deps.chats_update(
                    &self.chat_id,
                    &ChatPatch {
                        session_file_path: Some(session_file_path.clone()),
                        ..Default::default()
                    },
                ),
                (),
            );
            cell.lock_recover().chat.session_file_path = Some(session_file_path);
        }
    }
}
