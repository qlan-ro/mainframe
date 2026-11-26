use super::*;

impl SessionSinkImpl {
    pub(super) fn pause_held_queue(&self, reason: &str) {
        if self.holds_turn_queue()
            && !self.shared.queued_for_chat(&self.chat_id).is_empty()
            && self.shared.pause_maintenance_queue(&self.chat_id, reason)
        {
            self.notify_surface(ChatSurfaceEvent::QueueChanged {
                chat_id: self.chat_id.clone(),
                refs: self.shared.queued_for_chat(&self.chat_id),
            });
        }
    }

    pub(super) fn handle_queued_processed(&self, uuid: &str) {
        let steered = self
            .shared
            .queued_for_chat(&self.chat_id)
            .iter()
            .any(|r| r.uuid == uuid && r.steered == Some(true));
        let held = !steered && self.holds_turn_queue();
        if held {
            match self.shared.deps.idle_queue_remove(&self.chat_id, uuid) {
                Ok(true) => {}
                Ok(false) => return,
                Err(_) => {
                    warn!(
                        chat_id = self.chat_id,
                        "queue acknowledgement persistence failed"
                    );
                    return;
                }
            }
        }
        let running = self
            .shared
            .active(&self.chat_id)
            .is_some_and(|cell| crate::chat_manager::is_working(&cell.lock_recover().chat));
        let active_echo = held
            && self
                .shared
                .active_queue_echoes
                .remove_if(&self.chat_id, |_, expected| expected == uuid)
                .is_some();
        self.confirm_queue_echo(uuid, held, !steered && (!held || (active_echo && running)));
        self.finish_queue_echo(uuid, held && !running);
    }

    fn finish_queue_echo(&self, uuid: &str, drain: bool) {
        self.shared.handle_queued_processed(&self.chat_id, uuid);
        self.notify_surface(ChatSurfaceEvent::QueueChanged {
            chat_id: self.chat_id.clone(),
            refs: self.shared.queued_for_chat(&self.chat_id),
        });
        if drain {
            self.shared.schedule_maintenance_drain(&self.chat_id);
        }
    }

    fn confirm_queue_echo(&self, uuid: &str, held: bool, starts_turn: bool) {
        let Some(id) = self.find_queued_message_id(uuid) else {
            return;
        };
        {
            let mut messages = self.messages.lock_recover();
            if held {
                messages.update_in_place(&self.chat_id, |message| {
                    if message.id != id {
                        return false;
                    }
                    let metadata = message.metadata.get_or_insert_default();
                    metadata.remove("uuid");
                    metadata.remove("queueDelivery");
                    metadata.remove("queued").is_some()
                });
            } else {
                messages.strip_queued_and_move_to_end(&self.chat_id, &id);
            }
        }
        self.emit_display();
        if starts_turn {
            if self.shared.deps.idle_run_begin(&self.chat_id, uuid).is_ok() {
                if let Some(cell) = self.shared.active(&self.chat_id) {
                    cell.lock_recover().real_run_generation = Some(uuid.to_owned());
                }
            } else {
                warn!(chat_id = self.chat_id, "queued run persistence failed");
            }
            self.notify_surface(self.shared.turn_started_event(&self.chat_id));
        }
    }
    fn find_queued_message_id(&self, uuid: &str) -> Option<String> {
        let msgs = self.messages.lock_recover();
        msgs.get(&self.chat_id).and_then(|v| {
            v.iter()
                .find(|m| {
                    m.metadata
                        .as_ref()
                        .and_then(|md| md.get("uuid"))
                        .and_then(|v| v.as_str())
                        == Some(uuid)
                })
                .map(|m| m.id.clone())
        })
    }
    pub(super) fn reconcile_result_queue(&self) -> Vec<QueuedMessageRef> {
        let refs_before = self.shared.queued_for_chat(&self.chat_id);
        let ref_uuids: HashSet<String> = refs_before.iter().map(|r| r.uuid.clone()).collect();
        let mut cached_queued_uuids: HashSet<String> = HashSet::new();
        let mut display_changed = false;

        // Snapshot ids so moveToEnd (which splices the live vec) can't shift the loop.
        let snapshot = self.queued_snapshot();
        for (id, uuid, queued) in snapshot {
            if let (true, Some(u)) = (queued, uuid) {
                cached_queued_uuids.insert(u.clone());
                if !ref_uuids.contains(&u) {
                    self.messages
                        .lock_recover()
                        .strip_queued_and_move_to_end(&self.chat_id, &id);
                    display_changed = true;
                    warn!(
                        chat_id = self.chat_id,
                        uuid = u,
                        "orphan metadata.queued (no matching ref) — clearing"
                    );
                    self.shared.handle_queued_processed(&self.chat_id, &u);
                }
            }
        }

        for r in &refs_before {
            if !cached_queued_uuids.contains(&r.uuid) {
                warn!(
                    chat_id = self.chat_id,
                    uuid = r.uuid,
                    "orphan queuedRef (no matching cached message) — pruning"
                );
                self.shared.handle_queued_processed(&self.chat_id, &r.uuid);
            }
        }

        if display_changed {
            self.emit_display();
        }

        let refs_after = self.shared.queued_for_chat(&self.chat_id);
        self.notify_surface(ChatSurfaceEvent::QueueChanged {
            chat_id: self.chat_id.clone(),
            refs: refs_after.clone(),
        });
        refs_after
    }
    fn queued_snapshot(&self) -> Vec<(String, Option<String>, bool)> {
        {
            let msgs = self.messages.lock_recover();
            msgs.get(&self.chat_id)
                .map(|v| {
                    v.iter()
                        .map(|m| {
                            let uuid = m
                                .metadata
                                .as_ref()
                                .and_then(|md| md.get("uuid"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                            let queued = m
                                .metadata
                                .as_ref()
                                .and_then(|md| md.get("queued"))
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            (m.id.clone(), uuid, queued)
                        })
                        .collect()
                })
                .unwrap_or_default()
        }
    }
}
