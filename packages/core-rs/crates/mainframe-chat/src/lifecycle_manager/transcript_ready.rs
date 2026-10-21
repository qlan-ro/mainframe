use super::*;

pub(super) struct RestorationClaim {
    flight: FlightClaim,
    shared: Arc<ChatShared>,
    chat_id: String,
    cell: Option<Arc<Mutex<ActiveChat>>>,
    ready: bool,
}

impl RestorationClaim {
    pub(super) fn track(&mut self, cell: Option<Arc<Mutex<ActiveChat>>>) {
        self.cell = cell;
    }
    pub(super) fn finish(mut self) {
        self.ready = true;
    }
    fn waiter(&self) -> FlightWaiter {
        self.flight.waiter()
    }
}

impl Drop for RestorationClaim {
    fn drop(&mut self) {
        if !self.ready
            && let Some(cell) = &self.cell
        {
            let removed = self
                .shared
                .active_chats
                .remove_if(&self.chat_id, |_, current| Arc::ptr_eq(current, cell));
            if removed.is_some() {
                self.shared.messages.lock_recover().unpin(&self.chat_id);
            }
        }
    }
}

enum LoadAction {
    Offloading(FlightWaiter),
    Loading {
        complete: FlightWaiter,
        restored: Option<FlightWaiter>,
    },
    Loaded,
    Start {
        restored: RestorationClaim,
        complete: FlightClaim,
    },
}

impl ChatLifecycleManager {
    fn claim_load(&self, chat_id: &str) -> LoadAction {
        let guards = self.guards.lock_recover();
        if let Some(wait) = guards.offloading.get(chat_id) {
            return LoadAction::Offloading(wait);
        }
        if let Some(complete) = guards.loading.get(chat_id) {
            return LoadAction::Loading {
                complete,
                restored: guards.restoring.get(chat_id),
            };
        }
        if self.shared.active_chats.contains_key(chat_id) {
            return LoadAction::Loaded;
        }
        let complete = match guards.loading.claim(chat_id) {
            Ok(claim) => claim,
            Err(wait) => return LoadAction::Offloading(wait),
        };
        match guards.restoring.claim(chat_id) {
            Ok(flight) => LoadAction::Start {
                restored: RestorationClaim {
                    flight,
                    shared: Arc::clone(&self.shared),
                    chat_id: chat_id.to_owned(),
                    cell: None,
                    ready: false,
                },
                complete,
            },
            Err(wait) => LoadAction::Offloading(wait),
        }
    }

    pub async fn load_chat(&self, chat_id: &str) -> bool {
        loop {
            match self.claim_load(chat_id) {
                LoadAction::Offloading(wait) => wait.wait().await,
                LoadAction::Loading { complete, .. } => {
                    complete.wait().await;
                    if !self.shared.active_chats.contains_key(chat_id)
                        && self
                            .chat_or_db(chat_id)
                            .is_some_and(|chat| chat.status == ChatStatus::Active)
                    {
                        continue;
                    }
                    return false;
                }
                LoadAction::Loaded => {
                    self.touch(chat_id);
                    return false;
                }
                LoadAction::Start { restored, complete } => {
                    let changed = self.do_load_chat(chat_id, restored).await;
                    drop(complete);
                    return changed;
                }
            }
        }
    }

    pub(crate) async fn load_transcript(self: &Arc<Self>, chat_id: &str) {
        loop {
            match self.claim_load(chat_id) {
                LoadAction::Offloading(wait) => wait.wait().await,
                LoadAction::Loading { restored, complete } => {
                    if let Some(restored) = restored {
                        restored.wait().await;
                    }
                    if self.should_retry_restoration(chat_id) {
                        complete.wait().await;
                        continue;
                    }
                    self.touch(chat_id);
                    return;
                }
                LoadAction::Loaded => {
                    self.touch(chat_id);
                    return;
                }
                LoadAction::Start { restored, complete } => {
                    let ready = restored.waiter();
                    let lifecycle = Arc::clone(self);
                    let chat_id = chat_id.to_owned();
                    tokio::spawn(async move {
                        lifecycle.do_load_chat(&chat_id, restored).await;
                        drop(complete);
                    });
                    ready.wait().await;
                    return;
                }
            }
        }
    }

    pub(crate) async fn await_restoring(self: &Arc<Self>, chat_id: &str) {
        let restoring = self.guards.lock_recover().restoring.get(chat_id);
        if let Some(restoring) = restoring {
            restoring.wait().await;
            if self.should_retry_restoration(chat_id) {
                self.load_transcript(chat_id).await;
            }
        }
    }

    pub(crate) fn finish_resume_in_background(self: &Arc<Self>, chat_id: &str) {
        let Some(cell) = self.get_active(chat_id) else {
            self.publish_resume_state(chat_id);
            return;
        };
        let target = cell.lock_recover().chat.clone();
        let warmup = self.guards.lock_recover().loading.get(chat_id);
        let lifecycle = Arc::clone(self);
        let id = chat_id.to_owned();
        tokio::spawn(async move {
            if let Some(warmup) = warmup {
                warmup.wait().await;
            }
            if lifecycle.same_resume_target(&id, &cell, &target) {
                lifecycle.resume_chat(&id).await;
            } else {
                lifecycle.publish_resume_state(&id);
            }
        });
    }

    fn should_retry_restoration(&self, chat_id: &str) -> bool {
        !self.shared.active_chats.contains_key(chat_id)
            && self
                .chat_or_db(chat_id)
                .is_some_and(|chat| chat.status == ChatStatus::Active)
    }

    pub(crate) fn publish_resume_state(&self, chat_id: &str) {
        let Some(chat) = self.chat_or_db(chat_id) else {
            return;
        };
        self.shared.emit(DaemonEvent::ChatUpdated {
            chat: chat.clone(),
            reason: None,
        });
        if let Some(todos) = chat.todos {
            self.shared.emit(DaemonEvent::TodosUpdated {
                chat_id: chat_id.to_owned(),
                todos,
            });
        }
    }

    fn same_resume_target(
        &self,
        id: &str,
        expected: &Arc<Mutex<ActiveChat>>,
        target: &Chat,
    ) -> bool {
        self.get_active(id).is_some_and(|current| {
            if !Arc::ptr_eq(&current, expected) {
                return false;
            }
            let current = current.lock_recover();
            let chat = &current.chat;
            chat.status == ChatStatus::Active
                && chat.adapter_id == target.adapter_id
                && chat.vendor_session_id == target.vendor_session_id
                && chat.project_id == target.project_id
                && chat.worktree_path == target.worktree_path
        })
    }
}
