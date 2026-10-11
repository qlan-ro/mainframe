use super::*;

impl ProjectPaths for DaemonChatDeps {
    fn projects_get_path(&self, project_id: &str) -> Option<String> {
        let pid = project_id.to_string();
        self.db
            .call_blocking(move |d| d.projects.get(&pid))
            .ok()
            .flatten()
            .map(|p| p.path)
    }
    fn projects_remove(&self, project_id: &str) -> Result<(), SeamError> {
        let pid = project_id.to_string();
        self.db
            .call_blocking(move |d| d.projects.remove(&pid))
            .map_err(|err| {
                tracing::warn!(%err, project_id, "projects.remove failed");
                SeamError::new(err)
            })
    }
    fn path_exists(&self, path: &str) -> bool {
        std::path::Path::new(path).exists()
    }
    fn ensure_dir<'a>(&'a self, path: &'a str) -> BoxFuture<'a, ()> {
        let path = path.to_string();
        Box::pin(async move {
            if let Err(err) = tokio::fs::create_dir_all(&path).await {
                tracing::warn!(%err, path, "failed to create the chat's scratch directory");
            }
        })
    }
    fn fork_snapshots_dir(&self) -> String {
        self.data_dir
            .join("fork-snapshots")
            .to_string_lossy()
            .into_owned()
    }
    fn history_cache_dir(&self) -> String {
        self.data_dir
            .join("cache")
            .join("history")
            .to_string_lossy()
            .into_owned()
    }
}

impl EventEmitter for DaemonChatDeps {
    fn emit_event(&self, event: DaemonEvent) {
        // send() errors only when there are no WS subscribers — not fatal.
        let _ = self.broadcast.send(event);
    }

    fn tracker_remove_chat(&self, chat_id: &str) {
        self.background_tasks.remove_chat(chat_id);
    }
    fn tracker_list_live(&self, chat_id: &str) -> Vec<BackgroundTask> {
        self.background_tasks.list_live(chat_id)
    }
    fn tracker_end_all_running(&self, chat_id: &str) {
        self.background_tasks.end_all_running(chat_id);
    }
    fn workflow_runs_stop_all(&self, chat_id: &str) {
        self.claude_workflows.stop_all_running(chat_id);
    }
}

impl Pusher for DaemonChatDeps {
    fn should_notify_permission<'a>(&'a self, tool_name: Option<&'a str>) -> BoxFuture<'a, bool> {
        Box::pin(async move {
            should_notify_permission(&notification_config(&self.db).await, tool_name)
        })
    }
    fn notify_task_complete(&self) -> BoxFuture<'_, bool> {
        Box::pin(async { notification_config(&self.db).await.chat.task_complete })
    }
    fn notify_session_error(&self) -> BoxFuture<'_, bool> {
        Box::pin(async { notification_config(&self.db).await.chat.session_error })
    }
    fn notify_attention_request(&self) -> BoxFuture<'_, bool> {
        Box::pin(async { notification_config(&self.db).await.chat.attention_request })
    }
    fn send_push(&self, msg: PushOut) {
        let push = Arc::clone(&self.push);
        // A delegated child's gate names its parent and opens the top-level
        // chat whose card holds it (`taskChatId` names the card's chat);
        // every other push keeps the body its sink wrote and opens its chat.
        let delegated = match msg.push_type.as_str() {
            "permission" => {
                crate::orchestration_deps::push::delegated_permission_push(&self.db, &msg.chat_id)
            }
            _ => None,
        };
        let (body, data) = match delegated {
            Some(push) => (
                push.body,
                serde_json::json!({
                    "chatId": push.open_chat_id,
                    "taskChatId": msg.chat_id,
                    "type": msg.push_type,
                }),
            ),
            None => (
                msg.body,
                serde_json::json!({ "chatId": msg.chat_id, "type": msg.push_type }),
            ),
        };
        let message = PushMessage {
            title: msg.title,
            body,
            data,
            priority: if msg.priority == "high" {
                PushPriority::High
            } else {
                PushPriority::Default
            },
        };
        // Fire-and-forget: the caller does not wait for delivery.
        tokio::spawn(async move {
            push.send_push(message).await;
        });
    }
}

/// A `Send + Sync` `ContextDb` that routes `context-tracker`'s synchronous
/// `db.chats.*` reads/writes through the actor bridge.
pub(super) struct CtxDbHandle {
    pub(super) db: Db,
}

impl ContextDb for CtxDbHandle {
    fn add_mention(&self, chat_id: &str, mention: &SessionMention) -> bool {
        let (id, mention) = (chat_id.to_string(), mention.clone());
        self.db
            .call_blocking(move |d| d.chats.add_mention(&id, &mention))
            .unwrap_or(false)
    }

    fn get_mentions(&self, chat_id: &str) -> Vec<SessionMention> {
        let id = chat_id.to_string();
        self.db
            .call_blocking(move |d| d.chats.get_mentions(&id))
            .unwrap_or_default()
    }

    fn get_plan_files(&self, chat_id: &str) -> Vec<String> {
        let id = chat_id.to_string();
        self.db
            .call_blocking(move |d| d.chats.get_plan_files(&id))
            .unwrap_or_default()
    }

    fn get_skill_files(&self, chat_id: &str) -> Vec<SkillFileEntry> {
        let id = chat_id.to_string();
        self.db
            .call_blocking(move |d| d.chats.get_skill_files(&id))
            .unwrap_or_default()
    }
}

/// Bridges `AttachmentStore::list` (returns `StoredAttachmentMeta`) to the
/// context-tracker's `AttachmentLister` (wants `SessionAttachment`). The stored
/// meta is a structural superset of `SessionAttachment`; the projection drops
/// `materializedPath` and maps every other field across.
pub(super) struct AttachmentListerHandle {
    pub(super) store: Arc<AttachmentStore>,
}

impl AttachmentLister for AttachmentListerHandle {
    fn list<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Vec<SessionAttachment>> {
        Box::pin(async move {
            self.store
                .list(chat_id)
                .await
                .into_iter()
                .map(|m| SessionAttachment {
                    id: m.id,
                    name: m.name,
                    media_type: m.media_type,
                    size_bytes: m.size_bytes,
                    kind: match m.kind {
                        AttachmentKind::Image => SessionAttachmentKind::Image,
                        AttachmentKind::File => SessionAttachmentKind::File,
                    },
                    original_path: m.original_path,
                })
                .collect()
        })
    }
}
