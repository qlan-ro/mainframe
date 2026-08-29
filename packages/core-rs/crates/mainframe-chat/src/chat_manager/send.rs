//! The dispatch half of `send_message`: command vs plain text, and the
//! first-message titling both share.

use super::*;

/// Everything the plain-text tail needs from attachment processing, with the
/// typed text already folded in.
struct Outgoing {
    images: Vec<ImageInput>,
    attachment_previews: Vec<serde_json::Value>,
    message_content: Vec<MessageContent>,
    text: String,
}

impl ChatManager {
    /// First-message titling: the deterministic fallback, then LLM summarization.
    /// No-op once the chat has a title.
    fn assign_initial_title(&self, cell: &Arc<Mutex<ActiveChat>>, chat_id: &str, content: &str) {
        let title_empty = cell
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .chat
            .title
            .as_deref()
            .unwrap_or_default()
            .is_empty();
        if title_empty {
            // Both title paths must see the reader's text, not the markers the
            // composer wraps around it (message_markers.rs).
            let visible_content = visible_message_text(content);
            let title = derive_title_from_message(&visible_content);
            {
                let mut guard = cell.lock().unwrap_or_else(|e| e.into_inner());
                guard.chat.title = Some(title.clone());
            }
            self.deps.chats_update(
                chat_id,
                &ChatUpdate {
                    title: Some(title),
                    ..Default::default()
                },
            );
            let chat = cell.lock().unwrap_or_else(|e| e.into_inner()).chat.clone();
            self.emit(DaemonEvent::ChatUpdated { chat, reason: None });
            // TS fires `doGenerateTitle(...).catch(...)` WITHOUT awaiting: title
            // generation shells out to the CLI, so awaiting it here would both stall
            // the send and shift its `chat.updated` ahead of the turn's result/
            // contextUsage events. Spawn it so the emission lands after the turn,
            // matching Node's stream ordering.
            let lifecycle = self.lifecycle.clone();
            let chat_id_owned = chat_id.to_string();
            tokio::spawn(async move {
                lifecycle
                    .do_generate_title(&chat_id_owned, &visible_content)
                    .await;
            });
        }
    }

    /// Both dispatch shapes store and emit the user's text, so they share this.
    fn store_user_message(
        &self,
        chat_id: &str,
        message_content: Vec<MessageContent>,
        transient_metadata: HashMap<String, serde_json::Value>,
        attachment_ids: Option<&[String]>,
    ) -> ChatMessage {
        let message = self
            .messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .create_transient_message(
                chat_id,
                ChatMessageType::User,
                message_content,
                if transient_metadata.is_empty() {
                    None
                } else {
                    Some(transient_metadata)
                },
            );
        self.messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .append(chat_id, message.clone());
        self.event_handler.emit_display(chat_id);
        if attachment_ids.map(|a| !a.is_empty()).unwrap_or(false) {
            self.emit(DaemonEvent::ContextUpdated {
                chat_id: chat_id.to_string(),
                file_paths: None,
            });
        }
        message
    }

    async fn prepare_outgoing(
        &self,
        chat_id: &str,
        content: &str,
        attachment_ids: Option<&[String]>,
    ) -> Outgoing {
        let ProcessedAttachments {
            images,
            mut message_content,
            text_prefix,
            attachment_previews,
        } = match attachment_ids {
            Some(ids) if !ids.is_empty() => self.deps.process_attachments(chat_id, ids).await,
            _ => ProcessedAttachments::default(),
        };
        if !content.is_empty() {
            message_content.push(MessageContent::Leaf(LeafContent::Text {
                text: content.to_string(),
                parent_tool_use_id: None,
            }));
        }
        let text = if !text_prefix.is_empty() {
            if content.is_empty() {
                text_prefix.join("\n")
            } else {
                format!("{}\n\n{}", text_prefix.join("\n"), content)
            }
        } else {
            content.to_string()
        };
        Outgoing {
            images,
            attachment_previews,
            message_content,
            text,
        }
    }

    fn queued_message_metadata(
        &self,
        post: &Arc<Mutex<ActiveChat>>,
        session: &Arc<dyn AdapterSession>,
        attachment_previews: &[serde_json::Value],
    ) -> (HashMap<String, serde_json::Value>, Option<String>) {
        let adapter_acks_replay = session.supports_replay_ack();
        let is_queued = adapter_acks_replay
            && post
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .chat
                .process_state
                == Some(Some(ProcessState::Working));
        let mut transient_metadata: HashMap<String, serde_json::Value> = HashMap::new();
        if is_queued {
            transient_metadata.insert("queued".to_string(), serde_json::json!(true));
        }
        if !attachment_previews.is_empty() {
            transient_metadata.insert(
                "attachments".to_string(),
                serde_json::Value::Array(attachment_previews.to_vec()),
            );
        }
        let message_uuid = if is_queued {
            Some(nanoid::nanoid!())
        } else {
            None
        };
        if let Some(u) = &message_uuid {
            transient_metadata.insert("uuid".to_string(), serde_json::json!(u));
        }
        (transient_metadata, message_uuid)
    }

    fn record_queued_ref(
        &self,
        chat_id: &str,
        message: &ChatMessage,
        uuid: String,
        content: &str,
        attachment_ids: Option<&[String]>,
    ) {
        let r = QueuedMessageRef {
            message_id: message.id.clone(),
            chat_id: chat_id.to_string(),
            uuid: uuid.clone(),
            content: content.to_string(),
            attachment_ids: attachment_ids.filter(|a| !a.is_empty()).map(|a| a.to_vec()),
            timestamp: message.timestamp.clone(),
        };
        self.queued_refs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(uuid.clone(), r.clone());
        self.emit(DaemonEvent::MessageQueued {
            chat_id: chat_id.to_string(),
            r#ref: r,
        });
        info!(
            chat_id,
            uuid,
            message_id = message.id,
            "message sent to CLI while busy (queued)"
        );
    }

    /// Command dispatch: store and emit the user's text, title the chat, hand the
    /// command to the adapter (wrapped for mainframe-source commands), mark working.
    pub(super) async fn dispatch_command(
        &self,
        cmd: CommandMeta,
        post: &Arc<Mutex<ActiveChat>>,
        session: &Arc<dyn AdapterSession>,
        chat_id: &str,
        content: &str,
    ) -> Result<(), SendError> {
        self.store_user_message(
            chat_id,
            vec![MessageContent::Leaf(LeafContent::Text {
                text: content.to_string(),
                parent_tool_use_id: None,
            })],
            HashMap::new(),
            None,
        );
        self.assign_initial_title(post, chat_id, content);

        if cmd.source == "mainframe" {
            let resolved_args = cmd
                .args
                .clone()
                .or_else(|| find_mainframe_command(&cmd.name).and_then(|c| c.prompt_template));
            let wrapped = wrap_mainframe_command(&cmd.name, content, resolved_args.as_deref());
            session.send_message(wrapped, Vec::new(), None).await?;
        } else {
            session
                .send_command(cmd.name.clone(), cmd.args.clone())
                .await?;
        }
        let now = now_iso8601();
        self.set_working(post, chat_id, &now);
        let chat = post.lock().unwrap_or_else(|e| e.into_inner()).chat.clone();
        self.emit(DaemonEvent::ChatUpdated { chat, reason: None });
        // Commands are never queued behind a running turn, so acceptance
        // (send_entry.rs) and start are the same moment.
        self.event_handler.notify_chat_surface(
            crate::chat_surface::ChatSurfaceEvent::TurnStarted {
                chat_id: chat_id.to_string(),
            },
        );
        Ok(())
    }

    /// Plain-text send: attachments, the (possibly queued) user message, titling,
    /// working state, dispatch, and the queued-ref bookkeeping.
    pub(super) async fn send_plain_text(
        &self,
        post: &Arc<Mutex<ActiveChat>>,
        session: &Arc<dyn AdapterSession>,
        chat_id: &str,
        content: &str,
        attachment_ids: Option<&[String]>,
    ) -> Result<(), SendError> {
        let outgoing = self
            .prepare_outgoing(chat_id, content, attachment_ids)
            .await;

        let (transient_metadata, message_uuid) =
            self.queued_message_metadata(post, session, &outgoing.attachment_previews);

        let message = self.store_user_message(
            chat_id,
            outgoing.message_content,
            transient_metadata,
            attachment_ids,
        );

        if self.deps.extract_mentions_from_text(chat_id, content) {
            self.emit(DaemonEvent::ContextUpdated {
                chat_id: chat_id.to_string(),
                file_paths: None,
            });
        }

        self.assign_initial_title(post, chat_id, content);

        let now = now_iso8601();
        self.set_working(post, chat_id, &now);
        let chat = post.lock().unwrap_or_else(|e| e.into_inner()).chat.clone();
        self.emit(DaemonEvent::ChatUpdated { chat, reason: None });

        session
            .send_message(outgoing.text, outgoing.images, message_uuid.clone())
            .await?;

        if let Some(uuid) = message_uuid {
            self.record_queued_ref(chat_id, &message, uuid, content, attachment_ids);
            // Queued: `TurnStarted` waits for the CLI to dequeue it
            // (event_handler.rs's `on_queued_processed`).
        } else {
            self.event_handler.notify_chat_surface(
                crate::chat_surface::ChatSurfaceEvent::TurnStarted {
                    chat_id: chat_id.to_string(),
                },
            );
        }
        Ok(())
    }
}
