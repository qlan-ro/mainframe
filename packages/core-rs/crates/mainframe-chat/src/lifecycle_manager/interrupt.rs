use super::*;

impl ChatLifecycleManager {
    pub async fn interrupt_chat(&self, chat_id: &str) {
        let Some(cell) = self.get_active(chat_id) else {
            return;
        };
        let session = {
            let guard = cell.lock_recover();
            if !guard.session.as_ref().is_some_and(|s| s.is_spawned()) {
                return;
            }
            guard.session.clone()
        };

        let maintenance = self.shared.maintenance.active(chat_id)
            || session.as_ref().is_some_and(|s| !s.ready_for_input())
                && cell.lock_recover().chat.process_state != Some(Some(ProcessState::Working));
        {
            let mut perms = self.shared.permissions.lock_recover();
            perms.clear(chat_id);
            if !maintenance {
                perms.mark_interrupted(chat_id);
            }
        }

        // SIGINT causes the CLI to exit. Track the exit so sendMessage can wait.
        let claim = self.guards.lock_recover().interrupting.claim(chat_id);
        if let Ok(claim) = claim {
            let cell_poll = cell.clone();
            tokio::spawn(async move {
                let _claim = claim;
                let deadline = tokio::time::Instant::now() + Duration::from_millis(5000);
                loop {
                    let spawned = {
                        let g = cell_poll.lock_recover();
                        g.session.as_ref().is_some_and(|s| s.is_spawned())
                    };
                    if !spawned || tokio::time::Instant::now() >= deadline {
                        return;
                    }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            });
        }

        if let Some(session) = session
            && let Err(err) = session.interrupt().await
        {
            warn!(error = ?err, chat_id, "interrupt failed");
        }
    }
}
