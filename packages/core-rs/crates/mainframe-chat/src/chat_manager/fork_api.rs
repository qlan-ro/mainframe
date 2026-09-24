//! `ChatManager::fork_chat` (todo #343 Group 3) — the daemon-side orchestration
//! of the Fork action: the ordered eligibility checks from the spec's Behavior
//! list, pinning the fork point through the parent's adapter, and the single
//! INSERT that creates the fork. See
//! `docs/plans/2026-09-24-todo-343-fork-thread.md` "Group 3 — daemon-fork" item 1.
use super::*;

/// A turn is in flight when the main turn is running, or a permission/question
/// answer is pending. Deliberately NOT `display_status == Working` — live
/// background tasks alone put a chat in that state (spec edge case: "The parent
/// has background tasks still running but no turn in flight. Fork is allowed.").
fn turn_in_flight(chat: &Chat) -> bool {
    chat.is_running == Some(true) || chat.display_status == Some(DisplayStatus::Waiting)
}

impl ChatManager {
    /// Fork `chat_id` at its current point into a new chat that inherits its
    /// conversation. Checks run in the spec's order (not found, capability, no
    /// session, transcript missing, directory missing, turn in flight), then pins
    /// the fork point and inserts the new row. A failure after the eligibility
    /// checks removes any snapshot directory it created and leaves no chat row.
    pub async fn fork_chat(&self, chat_id: &str) -> Result<Chat, ForkChatError> {
        let parent = self
            .get_chat(chat_id)
            .ok_or_else(|| ForkChatError::NotFound(chat_id.to_string()))?;

        let adapter = self.deps.adapter_fork_info(&parent.adapter_id);
        if !adapter.fork {
            return Err(ForkChatError::Unsupported(adapter.name));
        }
        let Some(source_session_id) = parent.claude_session_id.clone() else {
            return Err(ForkChatError::NothingToForkYet);
        };
        if parent.transcript_missing == Some(true) {
            return Err(ForkChatError::TranscriptMissing);
        }
        if parent.directory_missing == Some(true) {
            return Err(ForkChatError::DirectoryMissing);
        }
        if turn_in_flight(&parent) {
            return Err(ForkChatError::TurnInFlight);
        }

        let project_path = self
            .deps
            .projects_get_path(&parent.project_id)
            .ok_or_else(|| ForkChatError::NotFound(chat_id.to_string()))?;
        let cwd = parent.worktree_path.clone().unwrap_or(project_path);

        let dest_dir = std::path::Path::new(&self.deps.fork_snapshots_dir())
            .join(nanoid::nanoid!())
            .to_string_lossy()
            .into_owned();

        let fork_source = match self
            .deps
            .pin_fork_point(
                &parent.adapter_id,
                ForkPinRequest {
                    source_session_id,
                    cwd,
                    session_file_path: parent.session_file_path.clone(),
                    dest_dir: dest_dir.clone(),
                },
            )
            .await
        {
            Ok(source) => source,
            Err(ForkPinError::Unsupported) => return Err(ForkChatError::Unsupported(adapter.name)),
            Err(ForkPinError::TranscriptMissing) => {
                remove_snapshot_dir(&dest_dir).await;
                return Err(ForkChatError::TranscriptMissing);
            }
            Err(ForkPinError::Failed(message)) => {
                remove_snapshot_dir(&dest_dir).await;
                return Err(ForkChatError::PinFailed(message));
            }
        };

        let provisional_title = fork_title(parent.title.as_deref());
        let insert = ForkCreateInput {
            parent_chat_id: parent.id.clone(),
            project_id: parent.project_id.clone(),
            adapter_id: parent.adapter_id.clone(),
            model: parent.model.clone(),
            permission_mode: parent.permission_mode,
            plan_mode: parent.plan_mode.unwrap_or(false),
            effort: parent.effort.flatten(),
            fast: parent.fast.flatten(),
            ultracode: parent.ultracode.flatten(),
            adaptive_thinking: parent.adaptive_thinking.flatten(),
            worktree_path: parent.worktree_path.clone(),
            branch_name: parent.branch_name.clone(),
            title: Some(provisional_title.clone()),
            pending_fork: PendingForkState {
                fork_source,
                snapshot_dir: dest_dir.clone(),
                provisional_title,
            },
        };

        let new_chat = match self.deps.create_fork(&insert) {
            Ok(chat) => chat,
            Err(message) => {
                remove_snapshot_dir(&dest_dir).await;
                return Err(ForkChatError::InsertFailed(message));
            }
        };

        self.active_chats.insert(
            new_chat.id.clone(),
            Arc::new(Mutex::new(ActiveChat {
                chat: new_chat.clone(),
                session: None,
                turn_started_at: None,
            })),
        );
        self.emit(DaemonEvent::ChatCreated {
            chat: new_chat.clone(),
            source: None,
        });
        Ok(new_chat)
    }
}

/// Best-effort cleanup of a snapshot directory a failed pin/insert leaves
/// behind — logged, never surfaced, matching the plan's "a failed pin removes
/// the directory" / "on insert failure it removes the directory".
async fn remove_snapshot_dir(dir: &str) {
    if let Err(err) = tokio::fs::remove_dir_all(dir).await
        && err.kind() != std::io::ErrorKind::NotFound
    {
        tracing::warn!(%err, dir, "failed to remove fork snapshot directory after a failed fork");
    }
}

#[cfg(test)]
mod turn_in_flight_tests {
    use super::*;
    use crate::test_support::test_chat;

    /// `turn_in_flight` is exercised directly (rather than only through
    /// `fork_chat`'s `StoreDeps`-backed tests) because `enrich_chat` — which
    /// `get_chat` always runs — recomputes both `is_running` and
    /// `display_status` from live state (process state / the permission
    /// manager's pending queue), so a fake chat's manually-set fields never
    /// survive to `fork_chat`'s eligibility check. This is the one path that
    /// actually observes a chat "waiting" on a permission/question answer.
    #[test]
    fn a_pending_permission_is_a_turn_in_flight() {
        let mut chat = test_chat("c1");
        chat.display_status = Some(DisplayStatus::Waiting);
        assert!(turn_in_flight(&chat));
    }

    #[test]
    fn a_running_main_turn_is_a_turn_in_flight() {
        let mut chat = test_chat("c1");
        chat.is_running = Some(true);
        assert!(turn_in_flight(&chat));
    }

    /// Spec edge case: live background tasks alone widen `display_status` to
    /// `Working` without a main turn running — that chat can still fork.
    #[test]
    fn working_from_background_tasks_alone_is_not_a_turn_in_flight() {
        let mut chat = test_chat("c1");
        chat.display_status = Some(DisplayStatus::Working);
        chat.is_running = Some(false);
        assert!(!turn_in_flight(&chat));
    }

    #[test]
    fn an_idle_chat_is_not_a_turn_in_flight() {
        let mut chat = test_chat("c1");
        chat.display_status = Some(DisplayStatus::Idle);
        chat.is_running = Some(false);
        assert!(!turn_in_flight(&chat));
    }
}
