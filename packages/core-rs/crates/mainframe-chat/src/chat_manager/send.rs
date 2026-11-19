//! The dispatch half of `send_message`: command vs plain text, and the
//! first-message titling both share. The queued-turn bookkeeping
//! (`queued_message_metadata`, `record_queued_ref`) lives in the sibling
//! `send_queue.rs`.

use super::*;
use mainframe_types::sync::LockExt as _;

impl ChatManager {
    /// First-message titling: the deterministic fallback, then LLM summarization.
    /// No-op once the chat has a title — EXCEPT a fork's provisional title, which
    /// still triggers generation on the first send even though it is non-empty:
    /// without this, a fork's `<title> (fork)` title would never be replaced. A
    /// user rename before that first message (the title no longer equals the
    /// stored provisional title) still wins, and so does disabled generation
    /// (`do_generate_title`'s own no-op).
    pub(super) fn assign_initial_title(
        &self,
        cell: &Arc<Mutex<ActiveChat>>,
        chat_id: &str,
        content: &str,
    ) {
        let current_title = cell.lock_recover().chat.title.clone().unwrap_or_default();
        let title_empty = current_title.is_empty();
        let is_untouched_fork_title =
            storage_event!(self.shared, Some(chat_id); self.shared.deps.get_pending_fork(chat_id))
                .is_some_and(|pending| pending.provisional_title == current_title);
        if !title_empty && !is_untouched_fork_title {
            return;
        }

        // Both title paths must see the reader's text, not the markers the
        // composer wraps around it (message_markers.rs).
        let visible_content = visible_message_text(content);

        if title_empty {
            let title = derive_title_from_message(&visible_content);
            {
                let mut guard = cell.lock_recover();
                guard.chat.title = Some(title.clone());
            }
            let chat = cell.lock_recover().chat.clone();
            storage_event!(
                self.shared, Some(chat_id);
                self.shared.update_and_emit(
                    chat,
                    &ChatPatch {
                        title: Some(title),
                        ..Default::default()
                    },
                )
            );
        }
        // Title generation runs WITHOUT awaiting: it shells out to the CLI, so
        // awaiting it here would both stall the send and shift its `chat.updated`
        // ahead of the turn's result/contextUsage events. Spawn it so the emission
        // lands after the turn. A fork's provisional title is left exactly as
        // `create_fork` stored it until generation produces one.
        let lifecycle = self.lifecycle.clone();
        let chat_id_owned = chat_id.to_string();
        tokio::spawn(async move {
            lifecycle
                .do_generate_title(&chat_id_owned, &visible_content)
                .await;
        });
    }

    /// Both dispatch shapes store and emit the user's text, so they share this.
    ///
    /// `vendor_id`, when given, becomes the stored message's own id in place of
    /// a minted nanoid — the same uuid handed to `send_message` below, so the
    /// CLI records this turn's transcript entry under the id the daemon already
    /// committed to live (live and cold-reloaded ids must match).
    pub(super) fn store_user_message(
        &self,
        chat_id: &str,
        message_content: Vec<MessageContent>,
        transient_metadata: HashMap<String, serde_json::Value>,
        attachment_ids: Option<&[String]>,
        vendor_id: Option<String>,
    ) -> ChatMessage {
        let message = self
            .shared
            .messages
            .lock_recover()
            .create_transient_message_with_vendor_id(
                chat_id,
                ChatMessageType::User,
                message_content,
                if transient_metadata.is_empty() {
                    None
                } else {
                    Some(transient_metadata)
                },
                vendor_id,
            );
        self.shared
            .messages
            .lock_recover()
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

    /// Command dispatch: store and emit the user's text, title the chat, hand the
    /// command to the adapter (wrapped for mainframe-source commands), mark working.
    pub(super) async fn dispatch_command(
        &self,
        cmd: CommandMeta,
        post: &Arc<Mutex<ActiveChat>>,
        session: &Arc<dyn AdapterSession>,
        chat_id: &str,
        content: &str,
        handoff: Option<&str>,
    ) -> Result<(), SendError> {
        // A command dispatched while another turn is already running is not a
        // turn start — a turn is already in progress. Only a command sent to a
        // free chat opens one.
        let was_working =
            post.lock_recover().chat.process_state == Some(Some(ProcessState::Working));
        self.store_user_message(
            chat_id,
            vec![MessageContent::Leaf(LeafContent::Text {
                text: content.to_string(),
                parent_tool_use_id: None,
            })],
            HashMap::new(),
            None,
            None,
        );
        self.assign_initial_title(post, chat_id, content);

        if cmd.source == "mainframe" {
            let resolved_args = cmd
                .args
                .clone()
                .or_else(|| find_mainframe_command(&cmd.name).and_then(|c| c.prompt_template));
            let wrapped = wrap_mainframe_command(&cmd.name, content, resolved_args.as_deref());
            session
                .send_message(with_handoff(handoff, wrapped), Vec::new(), None)
                .await?;
        } else {
            session
                .send_command(cmd.name.clone(), cmd.args.clone())
                .await?;
        }
        let now = now_iso8601();
        self.set_working(post, &now);
        // Commands are never queued behind a running turn, so acceptance
        // (send_entry.rs) and start are the same moment — UNLESS a turn was
        // already running: the command still bypasses the queue and runs
        // immediately, but that turn already started, so re-announcing it
        // would be a spurious running transition.
        if !was_working {
            self.event_handler
                .notify_chat_surface(self.shared.turn_started_event(chat_id));
        }
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
        delivery: Delivery<'_>,
    ) -> Result<(), SendError> {
        let outgoing = self
            .prepare_outgoing(chat_id, content, attachment_ids)
            .await;
        let (transient_metadata, message_uuid, is_queued) =
            self.queued_message_metadata(post, session, &outgoing.attachment_previews);
        let message = self.store_user_message(
            chat_id,
            outgoing.message_content,
            transient_metadata,
            attachment_ids,
            Some(message_uuid.clone()),
        );
        let handoff = match delivery {
            Delivery::Steer => {
                return self
                    .deliver_steer(
                        post,
                        session,
                        SteerMessage {
                            chat_id,
                            content,
                            attachment_ids,
                            message,
                            message_uuid,
                            is_queued,
                            text: outgoing.text,
                        },
                    )
                    .await;
            }
            Delivery::Turn { handoff } => handoff,
        };
        self.record_message_context(post, chat_id, content);
        let prior_state = post.lock_recover().chat.process_state.flatten();
        self.set_working(post, &now_iso8601());
        let uuid = Some(message_uuid.clone());
        let text = with_handoff(handoff, outgoing.text);
        if let Err(err) = session.send_message(text, outgoing.images, uuid).await {
            self.roll_back_refused_turn(post, chat_id, &message, prior_state, &err);
            return Err(err.into());
        }
        if is_queued {
            self.record_queued_ref(chat_id, &message, message_uuid, content, attachment_ids);
        } else {
            self.event_handler
                .notify_chat_surface(self.shared.turn_started_event(chat_id));
        }
        Ok(())
    }
}

fn with_handoff(handoff: Option<&str>, text: String) -> String {
    match handoff {
        Some(block) => crate::handoff::render::prepend_block(block, &text),
        None => text,
    }
}

mod delivery;
use delivery::SteerMessage;
