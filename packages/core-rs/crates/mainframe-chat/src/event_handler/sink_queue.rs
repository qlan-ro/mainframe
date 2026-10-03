use super::*;

impl<D: EventHandlerDeps + 'static> SessionSinkImpl<D> {
    pub(super) fn handle_queued_processed(&self, uuid: &str) {
        debug!(
            chat_id = self.chat_id,
            uuid, "onQueuedProcessed: moving queued message to end + clearing flag"
        );
        let found_id = {
            let msgs = self.messages.lock().unwrap_or_else(|e| e.into_inner());
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
        };
        if let Some(id) = &found_id {
            self.messages
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .strip_queued_and_move_to_end(&self.chat_id, id);
        }
        if found_id.is_some() {
            self.emit_display();
            // A queued prompt's `TurnAccepted` (send_entry.rs) is not
            // `TurnStarted` until the CLI actually dequeues it — this is that
            // signal (plan task 10's queued-turn start point).
            self.notify_surface(ChatSurfaceEvent::TurnStarted {
                chat_id: self.chat_id.clone(),
            });
        } else {
            warn!(
                chat_id = self.chat_id,
                uuid, "onQueuedProcessed: message not found in cache or already processed"
            );
        }
        self.deps.on_queued_processed(&self.chat_id, uuid);
        self.notify_surface(ChatSurfaceEvent::QueueChanged {
            chat_id: self.chat_id.clone(),
            refs: self.deps.get_queued_refs(&self.chat_id),
        });
    }
    pub(super) fn reconcile_result_queue(&self) -> Vec<QueuedMessageRef> {
        let refs_before = self.deps.get_queued_refs(&self.chat_id);
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
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .strip_queued_and_move_to_end(&self.chat_id, &id);
                    display_changed = true;
                    warn!(
                        chat_id = self.chat_id,
                        uuid = u,
                        "onResult: orphan metadata.queued (no matching ref) — clearing"
                    );
                    self.deps.on_queued_processed(&self.chat_id, &u);
                }
            }
        }

        for r in &refs_before {
            if !cached_queued_uuids.contains(&r.uuid) {
                warn!(
                    chat_id = self.chat_id,
                    uuid = r.uuid,
                    "onResult: orphan queuedRef (no matching cached message) — pruning"
                );
                self.deps.on_queued_processed(&self.chat_id, &r.uuid);
            }
        }

        if display_changed {
            self.emit_display();
        }

        let refs_after = self.deps.get_queued_refs(&self.chat_id);
        self.notify_surface(ChatSurfaceEvent::QueueChanged {
            chat_id: self.chat_id.clone(),
            refs: refs_after.clone(),
        });
        refs_after
    }
    fn queued_snapshot(&self) -> Vec<(String, Option<String>, bool)> {
        {
            let msgs = self.messages.lock().unwrap_or_else(|e| e.into_inner());
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
